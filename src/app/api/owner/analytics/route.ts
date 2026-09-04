import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { roundToTwo } from '@/lib/calculations';

export async function GET() {
  try {
    // 1. Fetch all completed/invoiced jobs with invoices
    const jobs = await prisma.job.findMany({
      include: {
        invoice: true,
        technician: true,
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // 2. Fetch all technicians
    const technicians = await prisma.user.findMany({
      where: { role: 'TECHNICIAN' },
      include: {
        settlements: true,
      },
    });

    let totalGrossRevenue = 0;
    let totalCashRevenue = 0;
    let totalInteracRevenue = 0;
    let totalCardRevenue = 0;
    let totalTaxHST = 0;
    let totalCommissionsEarned = 0;
    let activeJobsCount = 0;
    let completedJobsCount = 0;
    let abandonedJobsCount = 0;

    for (const job of jobs) {
      if (['NEW', 'DISPATCHED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(job.status)) {
        activeJobsCount++;
      }
      if (job.status === 'ABANDONED_TRAVEL_FEE') {
        abandonedJobsCount++;
      }
      if (job.invoice && job.invoice.paymentStatus === 'PAID') {
        completedJobsCount++;
        totalGrossRevenue += job.invoice.grandTotal;
        totalTaxHST += job.invoice.taxAmount;
        totalCommissionsEarned += job.workerCommission;

        if (job.invoice.paymentMethod === 'CASH') {
          totalCashRevenue += job.invoice.grandTotal;
        } else if (job.invoice.paymentMethod === 'INTERAC') {
          totalInteracRevenue += job.invoice.grandTotal;
        } else if (job.invoice.paymentMethod === 'STRIPE_CARD') {
          totalCardRevenue += job.invoice.grandTotal;
        }
      }
    }

    // 3. Calculate technician cash ledger
    const technicianLedger = technicians.map((tech) => {
      const techJobs = jobs.filter((j) => j.technicianId === tech.id);
      
      let cashCollected = 0;
      let commissionsEarned = 0;

      for (const j of techJobs) {
        if (j.invoice && j.invoice.paymentStatus === 'PAID') {
          commissionsEarned += j.workerCommission;
          if (j.invoice.paymentMethod === 'CASH') {
            cashCollected += j.invoice.grandTotal;
          }
        }
      }

      const totalSettled = tech.settlements.reduce((sum, s) => sum + s.amountSettled, 0);

      // Net cash owed:
      // Worker collected physical cash.
      // Offset by commissions the worker earned.
      // Offset by any prior cash handovers settled with owner.
      const netCashOwedToCompany = roundToTwo(cashCollected - commissionsEarned - totalSettled);

      return {
        id: tech.id,
        name: tech.name,
        phone: tech.phone,
        cashCollected: roundToTwo(cashCollected),
        commissionsEarned: roundToTwo(commissionsEarned),
        totalSettled: roundToTwo(totalSettled),
        netCashOwedToCompany,
        jobsCount: techJobs.length,
        settlements: tech.settlements,
      };
    });

    const netCompanyProfit = roundToTwo(totalGrossRevenue - totalTaxHST - totalCommissionsEarned);

    return NextResponse.json({
      success: true,
      summary: {
        totalGrossRevenue: roundToTwo(totalGrossRevenue),
        totalCashRevenue: roundToTwo(totalCashRevenue),
        totalInteracRevenue: roundToTwo(totalInteracRevenue),
        totalCardRevenue: roundToTwo(totalCardRevenue),
        totalTaxHST: roundToTwo(totalTaxHST),
        totalCommissionsEarned: roundToTwo(totalCommissionsEarned),
        netCompanyProfit,
        activeJobsCount,
        completedJobsCount,
        abandonedJobsCount,
        totalJobsCount: jobs.length,
      },
      technicianLedger,
      recentJobs: jobs.slice(0, 10),
    });
  } catch (err: any) {
    console.error('Owner analytics error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

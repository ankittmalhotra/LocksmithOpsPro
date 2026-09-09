import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { roundToTwo } from '@/lib/calculations';
import { getCurrentUser } from '@/lib/auth';
import { normalizeManualJobInvoice } from '@/lib/manual-job';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }

    // 1. Fetch all completed/invoiced jobs with invoices and items
    const rawJobs = await prisma.job.findMany({
      include: {
        invoice: true,
        technician: { select: { id: true, name: true, phone: true, email: true, commissionRate: true, active: true } },
        customer: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const jobs = rawJobs.map(normalizeManualJobInvoice);

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
    let totalPartsCost = 0;
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
      const isOnBooks = job.invoice?.taxCollected !== false;
      if (job.invoice && job.invoice.paymentStatus === 'PAID') {
        completedJobsCount++;
        totalGrossRevenue += job.invoice.grandTotal;
        // HST is recorded only for on-books jobs. Manual job totals are
        // tax-inclusive, so their stored taxAmount is the extracted HST.
        if (isOnBooks) totalTaxHST += job.invoice.taxAmount;
        totalCommissionsEarned += job.workerCommission;

        // Calculate wholesale parts cost (COGS)
        if (job.invoice.cogsAmount > 0) {
          totalPartsCost += job.invoice.cogsAmount;
        } else {
          for (const item of job.items || []) {
            if (item.isPart) {
              totalPartsCost += (item.unitCost || 0) * (item.quantity || 1);
            }
          }
        }

        if (job.invoice.paymentMethod === 'CASH') {
          totalCashRevenue += job.invoice.grandTotal;
        } else if (job.invoice.paymentMethod === 'INTERAC') {
          totalInteracRevenue += job.invoice.grandTotal;
        } else if (job.invoice.paymentMethod === 'STRIPE_CARD' || job.invoice.paymentMethod === 'DEBIT_CARD' || job.invoice.paymentMethod === 'CREDIT_CARD') {
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
            cashCollected += j.invoice.totalAmountCollected || j.invoice.grandTotal;
          }
        }
      }

      const totalSettled = tech.settlements.reduce((sum, s) => sum + s.amountSettled, 0);

      // Net cash owed:
      // Worker collected physical cash.
      // Offset by commissions the worker earned.
      // Offset by any prior cash handovers settled with the admin team.
      const netCashOwedToCompany = roundToTwo(cashCollected - commissionsEarned - totalSettled);

      return {
        id: tech.id,
        name: tech.name,
        phone: tech.phone,
        active: tech.active,
        commissionRate: tech.commissionRate,
        createdAt: tech.createdAt,
        cashCollected: roundToTwo(cashCollected),
        commissionsEarned: roundToTwo(commissionsEarned),
        totalSettled: roundToTwo(totalSettled),
        netCashOwedToCompany,
        jobsCount: techJobs.length,
        settlements: tech.settlements,
      };
    });

    const netCompanyProfit = roundToTwo(totalGrossRevenue - totalTaxHST - totalCommissionsEarned - totalPartsCost);

    return NextResponse.json({
      success: true,
      summary: {
        totalGrossRevenue: roundToTwo(totalGrossRevenue),
        totalCashRevenue: roundToTwo(totalCashRevenue),
        totalInteracRevenue: roundToTwo(totalInteracRevenue),
        totalCardRevenue: roundToTwo(totalCardRevenue),
        totalTaxHST: roundToTwo(totalTaxHST),
        totalCommissionsEarned: roundToTwo(totalCommissionsEarned),
        totalPartsCost: roundToTwo(totalPartsCost),
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
    console.error('Admin analytics error:', err);
    return NextResponse.json({ success: false, error: 'Unable to load Admin analytics' }, { status: 500 });
  }
}

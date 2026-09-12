import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { roundToTwo } from '@/lib/calculations';
import { getCurrentUser } from '@/lib/auth';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { findJobsWithDetails, findTechniciansWithSettlements } from '@/lib/job-helper';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';

async function handleGET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Admin access required' },
        { status: 403 }
      );
    }

    // 1. Fetch all completed/invoiced jobs with invoices and items
    const rawJobs = await findJobsWithDetails({ orderBy: { createdAt: 'desc' } });
    const jobs = rawJobs.map(normalizeManualJobInvoice);

    // 2. Fetch all technicians
    const technicians = await findTechniciansWithSettlements();

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

    // Build a fixed seven-day window using the same paid-invoice definition as
    // the financial totals above. Toronto is the business timezone, so a late
    // evening payment is grouped with the local calendar day the admin sees.
    const analyticsTimeZone = 'America/Toronto';
    const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: analyticsTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayKey = dateKeyFormatter.format(new Date());
    const [todayYear, todayMonth, todayDay] = todayKey.split('-').map(Number);
    const todayUtc = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay));
    const dailyByDate = new Map<string, {
      jobsCount: number;
      revenue: number;
      tax: number;
    }>();

    const last7Days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayUtc);
      date.setUTCDate(todayUtc.getUTCDate() - (6 - index));
      const dateKey = date.toISOString().slice(0, 10);
      dailyByDate.set(dateKey, { jobsCount: 0, revenue: 0, tax: 0 });

      return {
        date: dateKey,
        label: date.toLocaleDateString('en-CA', { weekday: 'short', timeZone: 'UTC' }),
        dateLabel: date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      };
    });

    for (const job of jobs) {
      if (!job.invoice || job.invoice.paymentStatus !== 'PAID') continue;

      const activityDate = job.invoice.paidAt || job.completedAt || job.createdAt;
      const dateKey = dateKeyFormatter.format(new Date(activityDate));
      const daily = dailyByDate.get(dateKey);
      if (!daily) continue;

      daily.jobsCount += 1;
      daily.revenue += job.invoice.grandTotal;
      if (job.invoice.taxCollected !== false) daily.tax += job.invoice.taxAmount;
    }

    const dailySeries = last7Days.map((day) => {
      const daily = dailyByDate.get(day.date)!;
      return {
        ...day,
        jobsCount: daily.jobsCount,
        revenue: roundToTwo(daily.revenue),
        tax: roundToTwo(daily.tax),
      };
    });

    const last7DaysJobs = dailySeries.reduce((sum, day) => sum + day.jobsCount, 0);
    const last7DaysRevenue = roundToTwo(dailySeries.reduce((sum, day) => sum + day.revenue, 0));
    const bestRevenueDay = last7DaysRevenue > 0
      ? dailySeries.reduce((best, day) => (day.revenue > best.revenue ? day : best), dailySeries[0])
      : null;

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
      last7Days: dailySeries,
      last7DaysSummary: {
        jobsCount: last7DaysJobs,
        revenue: last7DaysRevenue,
        averageTicket: last7DaysJobs > 0 ? roundToTwo(last7DaysRevenue / last7DaysJobs) : 0,
        bestRevenueDay: bestRevenueDay
          ? { date: bestRevenueDay.date, label: bestRevenueDay.dateLabel, revenue: bestRevenueDay.revenue }
          : null,
      },
      technicianLedger,
      recentJobs: jobs.slice(0, 10),
    });
  } catch (err: any) {
    logCaughtRequestError(request, '/api/owner/analytics', err);
    const errorCode = typeof err?.code === 'string' ? ` (${err.code})` : '';
    return NextResponse.json({ success: false, error: getApiErrorMessage(err, `Unable to load Admin analytics${errorCode}`) }, { status: 500 });
  }
}

export const GET = withRequestLogging('/api/owner/analytics', handleGET);

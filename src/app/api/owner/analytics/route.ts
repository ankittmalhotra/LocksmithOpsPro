import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { roundToTwo } from '@/lib/calculations';
import { getCurrentUser } from '@/lib/auth';
import { normalizeManualJobInvoice } from '@/lib/manual-job';
import { findJobsWithDetails, findTechniciansWithSettlements } from '@/lib/job-helper';
import { logCaughtRequestError, withRequestLogging } from '@/lib/request-logger';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  calculateGoogleAdsRoi,
  dateKeyToUtcDate,
  getMissingGoogleAdsConfigVariables,
  getGoogleAdsDateKeys,
  GOOGLE_ADS_PARTNER_COUNT,
  GOOGLE_ADS_RANGE_LABELS,
  GOOGLE_ADS_RANGE_OPTIONS,
  type GoogleAdsRoiRange,
  GOOGLE_ADS_TIME_ZONE,
} from '@/lib/google-ads';

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
      profit: number;
    }>();
    const profitByDate = new Map<string, number>();

    const last7Days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayUtc);
      date.setUTCDate(todayUtc.getUTCDate() - (6 - index));
      const dateKey = date.toISOString().slice(0, 10);
      dailyByDate.set(dateKey, { jobsCount: 0, revenue: 0, tax: 0, profit: 0 });

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
      const partsCost = job.invoice.cogsAmount > 0
        ? job.invoice.cogsAmount
        : (job.items || []).reduce((sum, item) => item.isPart ? sum + (item.unitCost || 0) * (item.quantity || 1) : sum, 0);
      const jobProfit = job.invoice.grandTotal
        - (job.invoice.taxCollected !== false ? job.invoice.taxAmount : 0)
        - job.workerCommission
        - partsCost;
      profitByDate.set(dateKey, (profitByDate.get(dateKey) || 0) + jobProfit);

      const daily = dailyByDate.get(dateKey);
      if (!daily) continue;

      daily.jobsCount += 1;
      daily.revenue += job.invoice.grandTotal;
      if (job.invoice.taxCollected !== false) daily.tax += job.invoice.taxAmount;
      daily.profit += jobProfit;
    }

    const requestedGoogleAdsRange = new URL(request.url).searchParams.get('googleAdsRange');
    const googleAdsRange: GoogleAdsRoiRange = GOOGLE_ADS_RANGE_OPTIONS.includes(requestedGoogleAdsRange as GoogleAdsRoiRange)
      ? requestedGoogleAdsRange as GoogleAdsRoiRange
      : 'today';
    const googleAdsDateKeys = getGoogleAdsDateKeys(googleAdsRange);
    const googleAdsStartDate = googleAdsDateKeys[0];
    const googleAdsEndDate = googleAdsDateKeys[googleAdsDateKeys.length - 1];
    const missingGoogleAdsVariables = getMissingGoogleAdsConfigVariables();
    const googleAdsConfigured = missingGoogleAdsVariables.length === 0;
    let googleAdsMetrics: Array<{
      spend: number;
      conversionsValue: number;
      clicks: number;
      impressions: number;
      syncedAt: Date;
    }> = [];
    let googleAdsStorageReady = true;
    if (googleAdsConfigured) {
      try {
        googleAdsMetrics = await prisma.googleAdsDailyMetric.findMany({
          where: {
            customerId: process.env.GOOGLE_ADS_CUSTOMER_ID!.replace(/[-\s]/g, ''),
            date: {
              gte: dateKeyToUtcDate(googleAdsStartDate),
              lte: dateKeyToUtcDate(googleAdsEndDate),
            },
          },
        });
      } catch (error: any) {
        if (error?.code === 'P2021') {
          googleAdsStorageReady = false;
        } else {
          throw error;
        }
      }
    }
    const googleAdsProfit = roundToTwo(googleAdsDateKeys.reduce((sum, date) => sum + (profitByDate.get(date) || 0), 0));
    const googleAdsSpend = googleAdsMetrics.length > 0
      ? roundToTwo(googleAdsMetrics.reduce((sum, metric) => sum + metric.spend, 0))
      : null;
    const companyGoogleAdsRoi = calculateGoogleAdsRoi(googleAdsProfit, googleAdsSpend);
    const partnerGoogleAdsRoi = calculateGoogleAdsRoi(googleAdsProfit / GOOGLE_ADS_PARTNER_COUNT, googleAdsSpend);
    const lastGoogleAdsSync = googleAdsMetrics.reduce<Date | null>((latest, metric) => (
      !latest || metric.syncedAt > latest ? metric.syncedAt : latest
    ), null);

    const dailySeries = last7Days.map((day) => {
      const daily = dailyByDate.get(day.date)!;
      return {
        ...day,
        jobsCount: daily.jobsCount,
        revenue: roundToTwo(daily.revenue),
        tax: roundToTwo(daily.tax),
        profit: roundToTwo(daily.profit),
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
      googleAds: {
        configured: googleAdsConfigured,
        currencyCode: process.env.GOOGLE_ADS_CURRENCY_CODE || 'CAD',
        range: googleAdsRange,
        rangeLabel: GOOGLE_ADS_RANGE_LABELS[googleAdsRange],
        dateFrom: googleAdsStartDate,
        dateTo: googleAdsEndDate,
        lastSyncedAt: lastGoogleAdsSync,
        missingVariables: missingGoogleAdsVariables,
        adSpend: googleAdsSpend,
        profit: googleAdsProfit,
        partnerCount: GOOGLE_ADS_PARTNER_COUNT,
        companyProfit: companyGoogleAdsRoi.profit,
        companyNetReturn: companyGoogleAdsRoi.netReturn,
        companyRoiPercent: companyGoogleAdsRoi.roiPercent,
        companyRoas: companyGoogleAdsRoi.roas,
        partnerProfit: partnerGoogleAdsRoi.profit,
        partnerNetReturn: partnerGoogleAdsRoi.netReturn,
        partnerRoiPercent: partnerGoogleAdsRoi.roiPercent,
        partnerRoas: partnerGoogleAdsRoi.roas,
        conversionsValue: googleAdsMetrics.length > 0 ? roundToTwo(googleAdsMetrics.reduce((sum, metric) => sum + metric.conversionsValue, 0)) : null,
        clicks: googleAdsMetrics.length > 0 ? googleAdsMetrics.reduce((sum, metric) => sum + metric.clicks, 0) : null,
        impressions: googleAdsMetrics.length > 0 ? googleAdsMetrics.reduce((sum, metric) => sum + metric.impressions, 0) : null,
        syncedDays: googleAdsMetrics.length,
        expectedDays: googleAdsDateKeys.length,
        status: googleAdsMetrics.length === googleAdsDateKeys.length
          ? 'synced'
          : googleAdsMetrics.length > 0 ? 'partially_synced' : googleAdsStorageReady ? 'not_synced' : 'migration_required',
        storageReady: googleAdsStorageReady,
        timeZone: GOOGLE_ADS_TIME_ZONE,
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

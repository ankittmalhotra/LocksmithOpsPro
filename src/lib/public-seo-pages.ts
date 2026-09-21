export interface MarketingSection {
  label: string;
  title: string;
  body: string;
  bullets: string[];
}

export interface MarketingPageDefinition {
  path: string;
  breadcrumbLabel: string;
  seoTitle: string;
  description: string;
  eyebrow: string;
  title: string;
  intro: string;
  highlightTitle: string;
  highlightText: string;
  sections: MarketingSection[];
  related: Array<{ href: string; label: string; description: string }>;
}

export const publicSeoPages: Record<string, MarketingPageDefinition> = {
  features: {
    path: '/features',
    breadcrumbLabel: 'Features',
    seoTitle: 'Locksmith Software Features | LockOps Pro',
    description: 'Explore LockOps Pro features for locksmith dispatch, mobile technicians, payment closeout, cash reconciliation, reporting, and role-based operations.',
    eyebrow: 'The complete platform',
    title: 'Every feature your locksmith operation needs to move with confidence.',
    intro: 'LockOps Pro brings the work around a locksmith job into one accountable record: the call, the assignment, the field details, the proof, the payment, and the handoff to the books.',
    highlightTitle: 'One job record. Fewer loose ends.',
    highlightText: 'The platform is organized around real roles and real handoffs, so dispatchers, technicians, owners, and accountants can work from the same operating story.',
    sections: [
      { label: '01 · Dispatch', title: 'Turn incoming calls into executable jobs.', body: 'Capture the customer, phone number, service address, problem, service type, schedule, and technician assignment without forcing the dispatcher to rebuild the story later.', bullets: ['Rapid call intake and customer details', 'Scheduled and historical jobs', 'Technician assignment and commission rates', 'Status visibility across the operation'] },
      { label: '02 · Field work', title: 'Give technicians the next action on the job site.', body: 'The mobile workflow puts the practical details first: where to go, who to call, what the job involves, and how to close it cleanly.', bullets: ['Maps and direct customer calling', 'Door, cam, and key-bitting details', 'Automotive vehicle and key fields', 'Signatures and proof-of-work photos'] },
      { label: '03 · Closeout', title: 'Connect the work to the money.', body: 'Closeouts make the record useful after the technician leaves. Capture the amount, payment method, tax, commission, and supporting proof in the same workflow.', bullets: ['Labor, parts, and Ontario HST calculations', 'Forward and reverse billing', 'Cash, Interac, and payment status tracking', 'Configured Stripe-hosted payment links'] },
      { label: '04 · Owner control', title: 'See the business behind the job count.', body: 'Owners need to know what was earned, what is outstanding, what contractors hold, and where leads become completed work.', bullets: ['Revenue, HST, and payment KPIs', 'Contractor cash-in-hand and handovers', 'Call conversion and marketing views where connected', 'CSV exports and role-based access'] },
    ],
    related: [
      { href: '/locksmith-dispatch-software', label: 'Locksmith dispatch software', description: 'Keep calls, assignments, schedules, and statuses moving.' },
      { href: '/locksmith-field-service-management', label: 'Field service management', description: 'Give technicians a focused mobile workflow.' },
      { href: '/locksmith-job-costing', label: 'Job costing and reconciliation', description: 'Connect closeout, payment, tax, and cash.' },
    ],
  },
  dispatch: {
    path: '/locksmith-dispatch-software',
    breadcrumbLabel: 'Locksmith Dispatch Software',
    seoTitle: 'Locksmith Dispatch Software | LockOps Pro',
    description: 'Locksmith dispatch software for call intake, scheduling, technician assignment, job status, customer details, and clean handoffs to the field.',
    eyebrow: 'For dispatch teams',
    title: 'Locksmith dispatch software that keeps every call moving.',
    intro: 'When the phone is busy, dispatchers need speed without losing context. LockOps Pro turns the first conversation into a job the technician can actually execute.',
    highlightTitle: 'Dispatch is the first promise you make to the customer.',
    highlightText: 'A complete intake record gives the field team the right address, problem, timing, customer details, and next action before they leave for the job.',
    sections: [
      { label: 'Capture', title: 'Start with a complete call record.', body: 'Record customer and phone details, extensions, service address, problem description, service type, and scheduling information in one place.', bullets: ['Residential, commercial, and automotive service types', 'Customer and phone details with extensions', 'Scheduled appointments and intake windows', 'Manual entry for completed or historical work'] },
      { label: 'Assign', title: 'Send the right job to the right technician.', body: 'Dispatchers can assign work with the context and commission configuration the technician needs, instead of relying on scattered messages.', bullets: ['Technician assignment and commission rates', 'Clear job ownership and status', 'Native Messages draft handoff', 'Role-based access for dispatch teams'] },
      { label: 'Follow through', title: 'Know where every job stands.', body: 'A visible status trail reduces repeat calls and makes it clear whether the next action belongs to dispatch or the field.', bullets: ['Acknowledgment and status progression', 'Active and historical job lists', 'Customer and service details stay attached', 'Closeout information returns to the same record'] },
    ],
    related: [
      { href: '/locksmith-field-service-management', label: 'Technician field workflow', description: 'See what the assigned technician can do from a phone.' },
      { href: '/locksmith-business-management', label: 'Business management', description: 'Connect dispatch activity to owner reporting.' },
      { href: '/features', label: 'All platform features', description: 'Explore the complete LockOps Pro workflow.' },
    ],
  },
  field: {
    path: '/locksmith-field-service-management',
    breadcrumbLabel: 'Field Service Management',
    seoTitle: 'Locksmith Field Service Management Software | LockOps Pro',
    description: 'Field service management software for locksmith technicians with mobile job details, maps, calls, statuses, signatures, photos, billing, and commissions.',
    eyebrow: 'For field technicians',
    title: 'Field service management software built for locksmith technicians.',
    intro: 'A technician does not need an office dashboard in their pocket. They need the address, the customer, the job details, the next action, and a reliable closeout flow.',
    highlightTitle: 'Less hunting. More doing.',
    highlightText: 'LockOps Pro keeps the field workflow focused on arriving prepared, doing the work, capturing proof, and closing the job without a second round of paperwork.',
    sections: [
      { label: 'Arrive prepared', title: 'Put the job details where the work happens.', body: 'Technicians can open the address, call the customer, and review the service context from a phone before and during the visit.', bullets: ['One-tap Google Maps or Apple Maps navigation', 'Direct customer calling with extensions', 'Customer, address, problem, and service details', 'Vehicle information for automotive work'] },
      { label: 'Do the work', title: 'Capture locksmith-specific details.', body: 'The workflow supports the details that make a locksmith job different from a generic work order.', bullets: ['Key bitting and key type details', 'Door, cam, and backset specifications', 'Vehicle year, make, model, VIN, and FCC ID', 'Status progression from acknowledgment to completion'] },
      { label: 'Close cleanly', title: 'Leave a record the customer and owner can understand.', body: 'Signatures, proof-of-work photos, payment information, and commission visibility help complete the job story before the technician moves on.', bullets: ['Pre-work authorization and completion signatures', 'Proof-of-work photo attachment', 'Forward and reverse billing calculations', 'Commission visibility for assigned technicians'] },
    ],
    related: [
      { href: '/automotive-locksmith-software', label: 'Automotive locksmith software', description: 'Explore vehicle-specific job capture and closeout.' },
      { href: '/commercial-locksmith-software', label: 'Commercial locksmith software', description: 'See how scheduled commercial work fits the workflow.' },
      { href: '/locksmith-dispatch-software', label: 'Dispatch software', description: 'Follow the job from first call to assignment.' },
    ],
  },
  business: {
    path: '/locksmith-business-management',
    breadcrumbLabel: 'Business Management',
    seoTitle: 'Locksmith Business Management Software | LockOps Pro',
    description: 'Locksmith business management software for owners who need revenue, tax, commissions, cash handovers, call conversion, exports, and team control.',
    eyebrow: 'For owners',
    title: 'Run the locksmith business behind the jobs.',
    intro: 'A busy schedule is not the same thing as a healthy operation. LockOps Pro connects completed work to revenue, tax, contractor balances, marketing signals, and the decisions an owner has to make next.',
    highlightTitle: 'Make the end of the day measurable.',
    highlightText: 'The owner view brings the operational and financial signals together without asking the team to maintain separate spreadsheets for every handoff.',
    sections: [
      { label: 'Money', title: 'Know what was earned and how it was paid.', body: 'See the relationship between completed work, payment methods, HST, and the amount collected instead of relying on memory at the end of the week.', bullets: ['Gross revenue and payment splits', 'Ontario HST visibility', 'Cash and Interac tracking', 'Reverse billing when the collected total is known first'] },
      { label: 'Accountability', title: 'Keep contractor cash handovers visible.', body: 'When technicians hold cash, the business needs a record of the balance, the handover, and the notes that explain it.', bullets: ['Contractor cash-in-hand ledger', 'Commission tracking', 'Recorded handover settlements', 'Audit notes attached to the operational record'] },
      { label: 'Growth', title: 'Understand where work comes from.', body: 'Where configured, connected call and advertising data can help owners compare activity, conversion, and marketing performance with completed jobs.', bullets: ['RingCentral inbound call analytics where connected', 'Call conversion views', 'Google Ads ROI view where configured', 'CSV export for accountant workflows'] },
      { label: 'Control', title: 'Give each person the right level of access.', body: 'Role-based access keeps the workspace usable for admins, dispatchers, technicians, and accounting workflows.', bullets: ['Admin, dispatcher, technician, and accountant roles', 'Team member management', 'Commission rate configuration', 'Accountant-ready operational exports'] },
    ],
    related: [
      { href: '/locksmith-job-costing', label: 'Job costing and reconciliation', description: 'Follow the money from closeout to handover.' },
      { href: '/locksmith-dispatch-software', label: 'Dispatch software', description: 'Connect owner reporting to call intake and assignment.' },
      { href: '/contact', label: 'Talk with LockOps Pro', description: 'Tell us how your operation works today.' },
    ],
  },
  automotive: {
    path: '/automotive-locksmith-software',
    breadcrumbLabel: 'Automotive Locksmith Software',
    seoTitle: 'Automotive Locksmith Software | LockOps Pro',
    description: 'Automotive locksmith software for vehicle job intake, VIN and key details, technician dispatch, proof of work, payment closeout, and owner visibility.',
    eyebrow: 'For automotive locksmith work',
    title: 'Automotive locksmith software for vehicle jobs that need the right details.',
    intro: 'Automotive jobs have a different intake story. LockOps Pro keeps vehicle identity and key information attached to the work order so dispatch and field teams are not piecing it together from separate messages.',
    highlightTitle: 'Vehicle details belong in the job record.',
    highlightText: 'Capture the information that helps the technician prepare, keeps the owner’s record complete, and supports a clearer customer closeout.',
    sections: [
      { label: 'Intake', title: 'Start with the vehicle, not a blank note.', body: 'Record the vehicle context during the call so the assigned technician knows what kind of job they are walking into.', bullets: ['Year, make, and model', 'VIN and key type', 'FCC ID details where relevant', 'Customer, phone, address, and problem details'] },
      { label: 'Dispatch', title: 'Send the right context to the field.', body: 'Automotive work can be time-sensitive. A complete assignment reduces the need for the technician to call back for basic vehicle information.', bullets: ['Technician assignment and status visibility', 'Scheduled or on-demand job intake', 'Native Messages draft handoff', 'Mobile access to the vehicle record'] },
      { label: 'Closeout', title: 'Finish the vehicle job with proof and payment.', body: 'The same job record can carry the completion details, proof, payment method, tax, and commission information through to reporting.', bullets: ['Completion status and notes', 'Signature and proof-of-work photo capture', 'Payment status and method tracking', 'Commission and owner reporting visibility'] },
    ],
    related: [
      { href: '/locksmith-field-service-management', label: 'Field service management', description: 'See the complete technician workflow.' },
      { href: '/locksmith-dispatch-software', label: 'Locksmith dispatch software', description: 'Keep automotive calls moving from intake to assignment.' },
      { href: '/locksmith-job-costing', label: 'Job costing and closeout', description: 'Connect payment and commission details.' },
    ],
  },
  commercial: {
    path: '/commercial-locksmith-software',
    breadcrumbLabel: 'Commercial Locksmith Software',
    seoTitle: 'Commercial Locksmith Software | LockOps Pro',
    description: 'Commercial locksmith software for scheduled service, door details, technician assignments, job history, proof of work, payment closeout, and follow-up.',
    eyebrow: 'For commercial locksmith work',
    title: 'Commercial locksmith software for scheduled service and repeat work.',
    intro: 'Commercial work often depends on better context: the site, the door, the hardware, the schedule, and what happened last time. LockOps Pro keeps those details attached to the job record.',
    highlightTitle: 'Make every commercial visit easier to pick up.',
    highlightText: 'A clear history helps dispatch and field teams continue the work without rebuilding the context from old texts, paper notes, or memory.',
    sections: [
      { label: 'Schedule', title: 'Plan work around the customer’s operating day.', body: 'Capture scheduled appointments and intake windows so the dispatch team can coordinate commercial service with more clarity.', bullets: ['Scheduled appointments and service windows', 'Customer and site details', 'Technician assignment and status', 'Historical job records for context'] },
      { label: 'Specify', title: 'Keep door and hardware details close to the work.', body: 'Commercial locksmith jobs benefit from precise field notes. The workflow supports door, cam, backset, and related service details.', bullets: ['Door and cam specifications', 'Backset and key-bitting details', 'Service problem and work notes', 'Photos and signatures for the record'] },
      { label: 'Follow through', title: 'Close the visit and preserve the history.', body: 'A clean closeout gives the customer and owner a usable record of what happened, what was paid, and what may need attention later.', bullets: ['Proof-of-work photos and signatures', 'Payment and tax visibility', 'Accountable technician handoff', 'Historical jobs available to the team'] },
    ],
    related: [
      { href: '/locksmith-field-service-management', label: 'Field service management', description: 'Give technicians the right job context on site.' },
      { href: '/locksmith-business-management', label: 'Business management', description: 'Bring commercial work into owner reporting.' },
      { href: '/contact', label: 'Discuss your workflow', description: 'Tell us what your commercial operation needs.' },
    ],
  },
  costing: {
    path: '/locksmith-job-costing',
    breadcrumbLabel: 'Job Costing',
    seoTitle: 'Locksmith Job Costing and Cash Reconciliation | LockOps Pro',
    description: 'Locksmith job costing software for labor, parts, HST, payment methods, commissions, contractor cash handovers, and accountant-ready exports.',
    eyebrow: 'For clean closeouts',
    title: 'Locksmith job costing that connects the work to the money.',
    intro: 'The job is not finished when the technician leaves. LockOps Pro helps locksmith businesses calculate the closeout, record the payment, track the commission, and reconcile the cash handoff.',
    highlightTitle: 'A better financial story starts at the job site.',
    highlightText: 'When labor, parts, tax, proof, payment, and handover notes stay connected, owners have fewer gaps to explain at the end of the day.',
    sections: [
      { label: 'Calculate', title: 'Support the way locksmith jobs are priced.', body: 'Use forward billing when labor and parts are known, or reverse billing when the amount collected is the starting point.', bullets: ['Labor plus parts calculations', 'Ontario HST visibility', 'Reverse billing from the collected total', 'Abandoned-job travel fee handling'] },
      { label: 'Collect', title: 'Record how the customer paid.', body: 'Payment method and status are part of the closeout record, not a separate note the owner has to reconstruct later.', bullets: ['Cash payment capture', 'Interac payment capture', 'Payment status tracking', 'Configured Stripe-hosted payment links'] },
      { label: 'Reconcile', title: 'Make technician balances accountable.', body: 'Commission and cash-in-hand views help owners understand what has been earned, what is held, and what has been handed over.', bullets: ['Technician commission tracking', 'Contractor cash-in-hand ledger', 'Cash handover settlements with notes', 'Operational records connected to money'] },
      { label: 'Export', title: 'Give the accountant a cleaner starting point.', body: 'Structured records and CSV export make it easier to continue the closeout in the accounting workflow your business already uses.', bullets: ['CSV export for accountant workflows', 'Revenue and payment split visibility', 'Tax and commission detail', 'Request IDs and failure logging where configured'] },
    ],
    related: [
      { href: '/locksmith-business-management', label: 'Locksmith business management', description: 'See the owner view around revenue and control.' },
      { href: '/locksmith-field-service-management', label: 'Field closeout workflow', description: 'Capture proof and billing where the work happens.' },
      { href: '/features', label: 'All platform features', description: 'Explore dispatch, field, payment, and reporting capabilities.' },
    ],
  },
};

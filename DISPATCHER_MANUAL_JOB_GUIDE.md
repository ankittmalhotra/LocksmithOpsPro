# Dispatcher Quick Guide: Add a Manual Job

Use **Add Manual Job** to record a completed or historical job. Manual jobs are saved as completed records and do not notify technicians.

## Add the Job

1. Open **Dispatch**.
2. Click **Add Manual Job**.
3. Enter the job and customer details below.
4. Confirm payment, costs, tax status, and technician information.
5. Click **Save Manual Job**.
6. Confirm the success message and check that the job appears in the table.

## What Each Field Means

| Field | Enter this | Why it matters |
|---|---|---|
| **Job number** | Unique numeric ID; enter digits only | Identifies the job; leading zeroes and large values are supported; duplicates are rejected |
| **Customer name** | Customer's full name | Makes the job easy to find |
| **Customer phone** | Complete phone number | Identifies and supports contact with the customer |
| **Extension** *(optional)* | Office or phone extension | Helps reach the right person |
| **Service address** | Where the work was completed | Records the job location |
| **Service type** | Best matching job type | Supports reporting and organization |
| **Other service type** | Exact type, only when **Other** is selected | Describes a service not in the list |
| **Description** | Short summary of work performed | Explains what happened on the job |
| **Payment method** | Cash, Interac, Debit Card, or Credit Card | Records how the customer paid |
| **Total collected** | Full amount received | Records job revenue |
| **COGS / parts amount** | Cost of parts or direct job costs | Records the job's direct cost |
| **Tax collected** | Choose **Yes - on books** or **No - off books** | Records bookkeeping status; it does not calculate tax |
| **Technician** | Technician who completed the job | Connects the job to the technician |
| **Other technician name** | Name, only when **Other** is selected | Records a technician not in the list |
| **Technician commission** | Amount owed to the technician | Supports payout and reporting |

## Check Before Saving

- Job number is unique.
- Customer name, phone, address, and description are complete.
- The correct service type and payment method are selected.
- The amount collected is greater than `$0`.
- COGS and commission are correct and are not negative.
- If **Other** is selected, the matching "Other" field is completed.

**Example:** Job `10452` | Residential Lockout | Cash | `$180.00` collected | `$0.00` COGS | Technician commission `$90.00`

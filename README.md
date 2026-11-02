# GAP WashHub Laundry — POS & Management System

Lot 3 Blk 14E Phase 3C Tamban St. Kaunlaran Village, Caloocan City

A point-of-sale and order-tracking system for the laundry counter. It runs in any modern
browser (Chrome or Edge recommended). It needs **no internet, no installation and no database server**.

## Project structure

```
gap-washhub-pos/
├── index.html         # App layout: dashboard, POS, order lists, payment & receipt dialogs
├── styles.css         # Design, responsive layout and thermal-receipt print styles
├── app.js             # All logic: services, cart, payments, statuses, receipts, storage
├── xlsx.full.min.js   # SheetJS library for Excel import/export (bundled, works offline)
├── logo.webp          # Shop logo
└── README.md
```

All files sit in one folder so they can be uploaded to GitHub from a tablet in one go.

## How to run (online, shared by all devices)

The app is hosted on GitHub Pages: **https://aalido.github.io/GAP-WashHub-Laundry-/**

Orders are saved in **Google Firebase (Cloud Firestore)**, project `gap-washhub-laundry`, on the free Spark plan.
Every device that signs in sees the same orders, updated live. Sign in with the shop email and password
(created in Firebase → Authentication → Users). To add staff, add another user there.

- The status under **Account** in the sidebar shows **Online · saved**, **Saving…**, or **Offline · will sync later**.
- Without internet the app still works on that device and sends the changes when the connection returns.
- Order numbers come from the server, so two devices never use the same number while online.
- The Firebase settings are in `FIREBASE_CONFIG` near the top of `app.js`.
- **Owners and staff:** the emails in `OWNER_EMAILS` (top of `app.js`) are owners and see everything. Every other
  login is staff: no Sales Summary, no "Total Sales Today" on the Dashboard, and no Import, Export, Edit,
  Delete order or Delete loyalty card. Staff can still take orders, mark them paid/claimed, print receipts and add loyalty ticks.

- **Activity Log** (owners only, in the sidebar): every new order, payment, claim, edit, delete, loyalty change and import
  is recorded with the person's email and the time. Pick a day, filter by person or "Staff only", or search.

Firestore security rules (Firestore → Rules). Only signed-in users can use the data, and nobody can erase the Activity Log:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    match /days/{day} { allow read, write: if signedIn(); }
    match /pos/{doc} { allow read, write: if signedIn(); }
    match /counters/{day} { allow read, write: if signedIn(); }
    match /logs/{day} {
      allow read, create: if signedIn();
      allow update: if signedIn() && request.resource.data.entries.hasAll(resource.data.entries);
    }
  }
}
```

## Daily workflow

```
NEW ORDER → CHECKOUT → PAYMENT → RECEIPT → PAID BUT NEED TO GET OUT → COMPLETED
NEW ORDER → CHECKOUT → NOT PAID → (MARK AS PAID when the customer pays and picks up) → COMPLETED
```

1. **+ New Order**: enter the customer name and, optionally, a contact number, then tap the services.
   **Date & Time** fills in automatically. To record an order from an earlier date or time (for example, one you
   forgot to enter), tap the field and pick the date and time. It shows "(edited)", and **Now** switches it back
   to automatic. Future dates are not allowed. A payment made at checkout is counted in that day's sales.
   Tapping the same service again adds 1 to its quantity. Use − / + / Remove to adjust. Add notes if needed.
   For a service not on the list, use **Other / Custom Service or Expense** below the buttons: type the name and amount,
   then tap **+ Add** or press Enter. It appears in the order and on the receipt like any other service.
   **Expenses:** tap **− Expense** (or type a negative amount such as -150). The amount becomes negative and is
   deducted from the total. Use it for a discount on a customer's order, or for a shop expense:
   put e.g. "Shop Expense" as the customer name, add only the expense, then CHECKOUT, choose Cash or GCash
   (where the money came from), then CONFIRM EXPENSE. Expense-only records go straight to Completed Orders.
2. **CHECKOUT** opens the payment panel. Choose **PAID** or **NOT PAID**, then **Cash** or **GCash**.
   Enter the amount received, or tap **EXACT AMOUNT** or a quick-cash button. The change is computed automatically.
   If the amount is short, the system shows how much is missing and won't let you confirm.
3. **Receipt**: choose the paper size (58mm, 80mm or a normal printer), then **PRINT RECEIPT** or **DONE**.
   **Pick-up number:** the receipt has two parts:
   - The top is a tear-off **customer stub** with a big pick-up number (e.g. **003**) and the customer's name. Tear it at
     "✂ TEAR HERE" and give it to the customer.
   - The rest is the **shop copy**, which stays with the laundry. It shows the same pick-up number under the customer's name,
     plus the order details. It has no shop header, loyalty box or closing text.
   The number restarts at 001 each day. To find an order, type the number (e.g. `3` or `#003`) in any search box.
   Order cards and tables show it as **#003**. Expense records have no pick-up number.
4. **Paid – Need to Get Out**: when the customer picks up their laundry, tap **MARK AS COMPLETED / CLAIMED**.
5. **Not Paid**: tap **MARK AS PAID** when the customer pays. The order goes straight to **Completed Orders** (paid and claimed). If the laundry was already released
   ("Released without payment"), the order stays in Completed Orders and is only marked PAID.
   The **Payment Date & Time** field defaults to now, and you can change it if the payment happened on another day.
   The payment counts in the sales of the day it was paid, not the day it was ordered. On that day the order
   also shows up in the Dashboard, the Sales Summary and the Order History date filter, marked "Ordered …" or "Paid …".
6. **Sales Summary** shows Gross Sales, Total Expenses and **Net Sales** (money received minus expenses),
   Cash and GCash totals, and the total unpaid balance. Unpaid orders are never counted as sales.
   Pick a date to see the totals for another day.
7. **Order History**: search or filter all orders and view or reprint any receipt.
   **Edit**: tap Edit on a Sales Summary, Order History or Dashboard row, or **EDIT** on a receipt. The order opens
   on the New Order screen ("Editing receipt …"). Change the customer, date, services, notes or loyalty ticks,
   then tap **SAVE CHANGES** and confirm the payment details. The Order No. stays the same.
   **Cancel edit** discards the changes.
8. **Delete**: every order card and history row has a **Delete** button. It asks for confirmation,
   then removes the order permanently. If the order was paid, its payment also leaves the sales totals.

Payment status (PAID / NOT PAID) and laundry status (PROCESSING / COMPLETED) are tracked separately.

## Loyalty card (★ Loyalty Card section)

- **1 tick per Package A, B or C.** The **7th** and **14th** ticks each earn **1 FREE Package A**. After 14 ticks a new card starts.
- **Ticks per order:** shown under the order list on New Order. They're counted automatically:
  - Each Package A, B or C counts as 1 tick (e.g. 2x Package B = 2 ticks).
  - Regular laundry services (Wash, Dry, Wash & Dry, etc.) and add-ons do not earn ticks.
  - Use − / + to change the count. Tap "(edited)" to go back to automatic.
- **Status while ordering:** once the customer name is typed, the panel shows their card. It announces when this order earns a free one.
- **Using a free:** tap the **Free (Package A)** service button (₱0). If the customer has no free available, the app asks before adding it.
  The free basket does not earn a tick.
- **Matching customers:** customers are matched by contact number. When there's no contact number, they're matched by name.
- **Paper cards and corrections:** in the Loyalty Card section, use **Add paper card / Adjust ticks** to enter ticks from an existing paper card, or to fix a mistake (e.g. `-1`).
- **Deleted orders:** deleting an order also removes its ticks.
- **Changing the rules:** the numbers (7 and 14) are in `LOYALTY` at the top of `app.js`.

## Printing on a thermal printer

- Install the printer's Windows driver and set it as the printer in the print dialog.
- In the print dialog, set **Margins: None** and turn off **Headers and footers**.
- Choose 58mm or 80mm in the receipt window, so the receipt width matches your paper.

## Backups (important)

Data is stored online, but still use **Export to Excel (.xlsx)** (sidebar) regularly and keep copies on a flash drive
or in Google Drive. The Excel file has 6 sheets: **Orders**, **Order Items**, **Payments**, **Daily Sales**
(gross, expenses and net per day), **Loyalty Cards** and **Loyalty Adjustments**.

**Import from Excel (.xlsx)** restores a file made with Export. It *replaces* the shared online data for **all devices**.
If you edit the file before importing, keep the sheet names and column headers, and do not change the "(ISO)" date columns.

## Data model

Firestore layout: `days/{YYYY-MM-DD}` holds that day's orders in a map `orders` (one document per day keeps
the free-plan read count low), `pos/meta` holds `loyaltyAdjust`, `loyaltyDeleted` and `seq`, and
`counters/{YYYY-MM-DD}` hands out order numbers, and `logs/{YYYY-MM-DD}` holds that day's Activity Log entries. Each order looks like this:

```jsonc
{
  "orders": [{
    "id": "GAP-261006-001",            // unique Order / Receipt No. (GAP-YYMMDD-###)
    "checkoutToken": "T…",             // blocks duplicate saves from double-clicks
    "createdAt": "ISO date",
    "customer": { "name": "Mara", "contact": "09123456789" },
    "items": [{ "id": "wash-dry", "name": "Wash & Dry", "price": 130, "qty": 2, "subtotal": 260 }],
    "notes": "…",
    "total": 320,
    "payments": [{ "method": "Cash", "amount": 320, "received": 500, "change": 180, "at": "ISO date", "ref": "" }],
    "amountPaid": 320, "balance": 0,
    "paymentStatus": "PAID",           // PAID | NOT PAID
    "paidAt": "ISO date",
    "orderStatus": "PROCESSING",       // PROCESSING | COMPLETED
    "completedAt": null
  }],
  "seq": { "2026-10-06": 1 },          // daily order-number counter
  "settings": { "paper": "80" }
}
```

To move to a server database later, these fields map directly to tables:
`customers(name, contact)`, `orders(id, created_at, customer_id, notes, total, amount_paid, balance,
payment_status, paid_at, order_status, completed_at)`, `order_items(order_id, service, price, qty, subtotal)`,
`payments(order_id, method, amount, received, change, ref, paid_at)`.

## Logo and colors

The logo is `logo.webp` (top-left of the screen). To change it, replace that file with a new one of the same name.
The brand colors (navy, royal blue, sky blue, yellow, red) are defined at the top of `styles.css`.

## Changing prices or services

Edit the `SERVICES` list at the top of `app.js`. Past orders keep the prices they were charged.

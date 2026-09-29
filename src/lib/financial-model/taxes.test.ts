import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { activeShare, ipContributionSchedule, taxRate, taxSchedule, usnVatExemptMonths, vatSchedule, type TaxMonthInput } from "./taxes";

const d = (v: number) => new Decimal(v);
const month = (year: number, m: number, income: number, expenses = 0, profit = 0): TaxMonthInput => ({
  year,
  month: m,
  income: d(income),
  expenses: d(expenses),
  profit: d(profit),
});
const nums = (xs: Decimal[]) => xs.map((x) => x.toNumber());

describe("taxSchedule", () => {
  it("USN on income: accrues monthly, pays the quarter in April and July", () => {
    const months = [1, 2, 3, 4, 5, 6, 7].map((m) => month(2027, m, 100000));
    const s = taxSchedule("usn_income", d(6), months);
    expect(nums(s.map((x) => x.accrued))).toEqual([6000, 6000, 6000, 6000, 6000, 6000, 6000]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 18000, 0, 0, 18000]);
    expect(s[6].payableEnd.toNumber()).toBe(6000);
  });

  it("USN income minus expenses: the 1 % minimum tax for the year, paid in March", () => {
    const months = [
      month(2026, 10, 100000, 99000),
      month(2026, 11, 100000, 99000),
      month(2026, 12, 100000, 99000),
      month(2027, 1, 100000, 99000),
      month(2027, 2, 100000, 99000),
      month(2027, 3, 100000, 99000),
    ];
    const s = taxSchedule("usn_income_expense", d(15), months);
    // 15 % of 3 000 is 450, below 1 % of 300 000 income: the year's tax is 3 000.
    expect(nums(s.map((x) => x.accrued))).toEqual([150, 150, 2700, 150, 150, 150]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 0, 0, 3000]);
  });

  it("profit tax: a loss reduces the tax since the start of the year", () => {
    const months = [month(2027, 1, 0, 0, 100000), month(2027, 2, 0, 0, -150000), month(2027, 3, 0, 0, 100000), month(2027, 4, 0, 0, 0)];
    const s = taxSchedule("profit", d(25), months);
    expect(nums(s.map((x) => x.accrued))).toEqual([25000, -25000, 12500, 0]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 12500]);
  });

  it("uses the standard rate when none is set and nothing without a regime", () => {
    expect(taxRate("usn_income", null).toNumber()).toBe(6);
    expect(taxRate("usn_income_expense", "").toNumber()).toBe(15);
    expect(taxRate("profit", "20").toNumber()).toBe(20);
    expect(taxSchedule("none", d(0), [month(2027, 1, 100)])[0].accrued.toNumber()).toBe(0);
  });
});

describe("taxSchedule — AUSN, ESHN and rates by year", () => {
  it("AUSN is paid every month for the previous one, with the 3 % annual minimum", () => {
    const months = [11, 12].map((m) => month(2026, m, 100000, 99000)).concat([month(2027, 1, 100000, 99000)]);
    const s = taxSchedule("ausn_income_expense", d(20), months);
    // 20 % of 1 000 a month; December tops the year up to 3 % of 200 000 income = 6 000.
    expect(nums(s.map((x) => x.accrued))).toEqual([200, 5800, 200]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 200, 5800]);
  });

  it("ESHN is paid for the half-year in July", () => {
    const months = [1, 2, 3, 4, 5, 6, 7].map((m) => month(2027, m, 100000, 50000));
    const s = taxSchedule("eshn", d(6), months);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 0, 0, 0, 18000]);
  });

  it("uses each year's own rate", () => {
    const s = taxSchedule("usn_income", (y) => d(y === 2026 ? 6 : 4), [month(2026, 12, 100000), month(2027, 1, 100000)]);
    expect(nums(s.map((x) => x.accrued))).toEqual([6000, 4000]);
  });
});

describe("ipContributionSchedule — sole proprietor's own contributions", () => {
  it("fixed ones: evenly by month, paid in December; 1 % above 300 000 a year: paid next July", () => {
    const months = [...Array.from({ length: 12 }, (_, i) => month(2026, i + 1, 100000)), ...[1, 2, 3, 4, 5, 6, 7].map((m) => month(2027, m, 0))];
    const s = ipContributionSchedule(
      {
        base: "income",
        forYear: (y) => ({ fixed: y === 2026 ? d(57390) : null, income: { ratePct: d(1), threshold: d(300000), max: d(321818) } }),
      },
      months,
    );
    const accrued2026 = s.slice(0, 12).reduce((a, x) => a.plus(x.accrued), d(0));
    // 57 390 fixed + 1 % of (1 200 000 − 300 000).
    expect(accrued2026.toNumber()).toBe(57390 + 9000);
    expect(nums(s.slice(2, 4).map((x) => x.accrued))).toEqual([4782.5, 5782.5]); // the 1 % starts once the income passes 300 000
    expect(s[11].paid.toNumber()).toBe(57390);
    expect(s[18].paid.toNumber()).toBe(9000); // July 2027
    expect(s[18].payableEnd.toNumber()).toBe(0);
  });

  it("the 1 % stops at the annual maximum and counts income minus expenses where the tax does", () => {
    const params = (base: "income" | "income_minus_expenses") => ({
      base,
      forYear: () => ({ fixed: null, income: { ratePct: d(1), threshold: d(300000), max: d(321818) } }),
    });
    expect(ipContributionSchedule(params("income"), [month(2026, 1, 50000000)])[0].accrued.toNumber()).toBe(321818);
    expect(ipContributionSchedule(params("income_minus_expenses"), [month(2026, 1, 1000000, 600000)])[0].accrued.toNumber()).toBe(1000);
  });
});

describe("taxSchedule — USN on income reduced by insurance contributions", () => {
  const withContributions = (hasEmployeesFrom: number | null) =>
    [1, 2, 3, 4].map((m) => ({
      ...month(2027, m, m === 4 ? 0 : 100000),
      deductibleContributions: d(m === 1 ? 10000 : 0),
      hasEmployees: hasEmployeesFrom !== null && m >= hasEmployeesFrom,
    }));

  it("without employees — by the contributions in full, year to date", () => {
    const s = taxSchedule("usn_income", d(6), withContributions(null));
    expect(nums(s.map((x) => x.reduction))).toEqual([6000, 4000, 0, 0]);
    expect(nums(s.map((x) => x.accrued))).toEqual([0, 2000, 6000, 0]);
    expect(s[3].paid.toNumber()).toBe(8000); // Q1: 18 000 − 10 000
  });

  it("once there are employees — by no more than half of the tax", () => {
    const s = taxSchedule("usn_income", d(6), withContributions(2));
    // January: no employees yet, reduced in full; from February the limit is 50 % of the tax since the start of the year.
    expect(nums(s.map((x) => x.reduction))).toEqual([6000, 0, 3000, 0]);
    expect(nums(s.map((x) => x.accrued))).toEqual([0, 6000, 3000, 0]);
    expect(s[3].paid.toNumber()).toBe(9000);
  });

  it("other regimes ignore the reduction", () => {
    const s = taxSchedule("usn_income_expense", d(15), withContributions(null));
    expect(nums(s.map((x) => x.reduction))).toEqual([0, 0, 0, 0]);
  });
});

describe("sole proprietor's contributions for an incomplete year", () => {
  const utc = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));
  const params = (from: Date | null, to: Date | null) => ({
    base: "income" as const,
    forYear: () => ({ fixed: d(57390), income: { ratePct: d(1), threshold: d(300000), max: d(321818) } }),
    activeFrom: from,
    activeTo: to,
  });

  it("registered on 16 March: full months after it plus the days of March", () => {
    expect(activeShare(2026, 3, utc(2026, 3, 16), null).toNumber()).toBeCloseTo(16 / 31, 10);
    const s = ipContributionSchedule(params(utc(2026, 3, 16), null), Array.from({ length: 12 }, (_, i) => month(2026, i + 1, 0)));
    expect(nums(s.slice(0, 2).map((x) => x.accrued))).toEqual([0, 0]);
    // 57 390 × (9 + 16/31) / 12
    expect(s.reduce((a, x) => a.plus(x.accrued), d(0)).toNumber()).toBe(45510.89);
    expect(s[11].paid.toNumber()).toBe(45510.89);
  });

  it("closed on 10 June: contributions until then, everything for the year within 15 days", () => {
    const s = ipContributionSchedule(params(null, utc(2026, 6, 10)), Array.from({ length: 12 }, (_, i) => month(2026, i + 1, 100000)));
    // Fixed: 57 390 × (5 + 10/30) / 12; 1 % of (600 000 − 300 000) — income after June is not counted.
    expect(s.reduce((a, x) => a.plus(x.accrued), d(0)).toNumber()).toBe(25506.67 + 3000);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 0, 0, 28506.67, 0, 0, 0, 0, 0, 0]);
    expect(nums(s.slice(6).map((x) => x.accrued))).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("the actual figures since 1 January before the forecast", () => {
  it("the tax counts the whole year; the months before the forecast are settled outside it", () => {
    const opening = { year: 2027, months: 4, income: d(400000), expenses: d(0), profit: d(0) };
    const s = taxSchedule("usn_income", d(6), [5, 6, 7].map((m) => month(2027, m, 100000)), opening);
    expect(nums(s.map((x) => x.accrued))).toEqual([6000, 6000, 6000]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 12000]); // July: Q2 only
  });

  it("the minimum tax and the 300 000 threshold count the income before the forecast", () => {
    const opening = { year: 2026, months: 11, income: d(1100000), expenses: d(1100000), profit: d(0) };
    expect(taxSchedule("usn_income_expense", d(15), [month(2026, 12, 100000, 100000)], opening)[0].accrued.toNumber()).toBe(12000);
    const contributions = ipContributionSchedule(
      { base: "income", forYear: () => ({ fixed: null, income: { ratePct: d(1), threshold: d(300000), max: null } }) },
      [month(2026, 4, 100000)],
      { year: 2026, months: 3, income: d(250000), expenses: d(0), profit: d(0) },
    );
    expect(contributions[0].accrued.toNumber()).toBe(500);
  });
});

describe("vatSchedule", () => {
  const vatMonth = (m: number, revenue: number, purchases: number) => ({
    year: 2027,
    month: m,
    revenue: d(revenue),
    purchases: d(purchases),
    collections: d(revenue),
    supplierPayments: d(purchases),
  });

  it("22 %: charged on revenue minus the suppliers' VAT, paid in thirds in the three months after the quarter", () => {
    const s = vatSchedule({ rateForYear: () => d(22) }, [1, 2, 3, 4, 5, 6].map((m) => vatMonth(m, m <= 3 ? 100000 : 0, m <= 3 ? 30000 : 0)));
    expect(nums(s.slice(0, 3).map((x) => x.received))).toEqual([22000, 22000, 22000]);
    expect(nums(s.slice(0, 3).map((x) => x.paidToSuppliers))).toEqual([6600, 6600, 6600]);
    expect(nums(s.slice(0, 3).map((x) => x.accrued))).toEqual([15400, 15400, 15400]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 15400, 15400, 15400]);
    expect(s[5].payableEnd.toNumber()).toBe(0);
  });

  it("5 % on USN: no deduction; a deduction above the charge moves to the next quarter", () => {
    const five = vatSchedule({ rateForYear: () => d(5) }, [vatMonth(1, 100000, 30000)]);
    expect([five[0].accrued.toNumber(), five[0].paidToSuppliers.toNumber()]).toEqual([5000, 0]);
    const carry = vatSchedule(
      { rateForYear: () => d(22) },
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => vatMonth(m, m === 4 || m === 5 ? 100000 : 0, m === 1 ? 100000 : 0)),
    );
    // Q1: −22 000 carried; Q2: 44 000 − 22 000 = 22 000 in thirds.
    expect(nums(carry.slice(6).map((x) => x.paid))).toEqual([7333.33, 7333.33, 7333.34]);
  });
});

describe("contributions owed for the months before the forecast", () => {
  it("start in the balance to pay, so paying the whole year in December leaves no negative debt", () => {
    const s = ipContributionSchedule(
      { base: "income", forYear: () => ({ fixed: d(12000), income: null }) },
      [10, 11, 12].map((m) => month(2026, m, 0)),
      { year: 2026, months: 9, income: d(0), expenses: d(0), profit: d(0) },
    );
    expect(nums(s.map((x) => x.accrued))).toEqual([1000, 1000, 1000]);
    expect(nums(s.map((x) => x.payableEnd))).toEqual([10000, 11000, 0]);
    expect(s[2].paid.toNumber()).toBe(12000);
  });
});

describe("USN free of VAT within the income limit", () => {
  const m = (year: number, month: number, income: number) => ({ year, month, income: d(income) });
  it("free while the income since 1 January stays within the limit; VAT from the month after it is exceeded", () => {
    const months = [1, 2, 3, 4, 5, 6].map((k) => m(2026, k, 5000000));
    expect(usnVatExemptMonths(months, d(15000000), null)).toEqual([true, true, true, true, true, false]);
    expect(usnVatExemptMonths(months, d(25000000), null)).toEqual([false, false, false, false, false, false]);
    expect(usnVatExemptMonths([m(2024, 12, 99000000)], d(99000000), null)).toEqual([true]); // no VAT on USN before 2025
  });

  it("counts the actual income since 1 January and the forecast's own year for the next one", () => {
    const months = [m(2026, 10, 1000000), m(2026, 11, 1000000), m(2026, 12, 1000000), m(2027, 1, 0)];
    // 2026: 18 + 3 = 21 million — above the 2027 limit of 15 million.
    expect(usnVatExemptMonths(months, d(0), { year: 2026, income: d(18000000) })).toEqual([true, true, true, false]);
  });
});

describe("vatSchedule — before the forecast and exempt months", () => {
  const vatMonth = (month: number, revenue: number, exempt = false) => ({
    year: 2027,
    month,
    revenue: d(revenue),
    purchases: d(0),
    collections: d(revenue),
    supplierPayments: d(0),
    exempt,
  });

  it("pays the rest of the previous quarter's thirds and adds the months of this quarter before the forecast", () => {
    const opening = { previousQuarter: { output: d(30000), input: d(0) }, currentQuarter: { output: d(5000), input: d(0) } };
    const s = vatSchedule({ rateForYear: () => d(22), opening }, [2, 3, 4, 5, 6].map((k) => vatMonth(k, 0)));
    // Q4 2026: 30 000 in thirds, January's third already paid; Q1 2027: January's 5 000 from the documents.
    expect(nums(s.map((x) => x.paid))).toEqual([10000, 10000, 1666.67, 1666.67, 1666.66]);
    expect(s[4].payableEnd.toNumber()).toBe(0);
  });

  it("an exempt month has no VAT", () => {
    const s = vatSchedule({ rateForYear: () => d(5) }, [vatMonth(1, 100000, true), vatMonth(2, 100000)]);
    expect(nums(s.map((x) => x.accrued))).toEqual([0, 5000]);
    expect(nums(s.map((x) => x.received))).toEqual([0, 5000]);
  });
});

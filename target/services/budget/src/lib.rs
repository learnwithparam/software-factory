//! Budget rules for agent spend.
//!
//! Every amount is an integer in minor units. No amount is ever divided, and
//! percentages are computed by multiplying first, so a cent is never lost to a
//! float. `spent + remaining == limit` is an invariant the tests assert rather
//! than a comment nobody checks.
//!
//! This crate is the money path. The factory charter marks it load bearing, so
//! an agent may propose a change here but never land one unattended.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Currency {
    Eur,
    Usd,
}

impl Currency {
    pub fn code(self) -> &'static str {
        match self {
            Currency::Eur => "EUR",
            Currency::Usd => "USD",
        }
    }

    pub fn parse(code: &str) -> Option<Currency> {
        match code {
            "EUR" => Some(Currency::Eur),
            "USD" => Some(Currency::Usd),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Under,
    Warning,
    Breached,
}

impl State {
    pub fn name(self) -> &'static str {
        match self {
            State::Under => "under",
            State::Warning => "warning",
            State::Breached => "breached",
        }
    }
}

/// Mirrors packages/contracts/schema/budget.schema.json.
/// `tests/contract.rs` asserts the field names below equal that schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Budget {
    pub period: String,
    pub limit_minor: i64,
    pub spent_minor: i64,
    pub remaining_minor: i64,
    pub currency: Currency,
    pub state: State,
}

#[derive(Debug, PartialEq, Eq)]
pub enum BudgetError {
    LimitNotPositive,
    SpendNegative,
    PeriodMalformed,
}

/// Spend at or above this share of the limit is a warning.
const WARNING_PERCENT: i64 = 80;

/// A period is a calendar month, written as `YYYY-MM`.
fn period_is_well_formed(period: &str) -> bool {
    let bytes = period.as_bytes();
    if bytes.len() != 7 || bytes[4] != b'-' {
        return false;
    }
    if !bytes[..4].iter().all(u8::is_ascii_digit) || !bytes[5..].iter().all(u8::is_ascii_digit) {
        return false;
    }
    let month: i64 = period[5..].parse().unwrap_or(0);
    (1..=12).contains(&month)
}

/// Where spend sits against a limit. Multiplies before comparing, so no ratio is
/// ever computed as a float.
pub fn state_for(spent_minor: i64, limit_minor: i64) -> State {
    if spent_minor >= limit_minor {
        State::Breached
    } else if spent_minor * 100 >= limit_minor * WARNING_PERCENT {
        State::Warning
    } else {
        State::Under
    }
}

/// Build a budget for a period. Overspend is reported as a negative remainder
/// rather than clamped to zero, because hiding it is how a breach goes unnoticed.
pub fn assess(
    period: &str,
    limit_minor: i64,
    spent_minor: i64,
    currency: Currency,
) -> Result<Budget, BudgetError> {
    if !period_is_well_formed(period) {
        return Err(BudgetError::PeriodMalformed);
    }
    if limit_minor <= 0 {
        return Err(BudgetError::LimitNotPositive);
    }
    if spent_minor < 0 {
        return Err(BudgetError::SpendNegative);
    }
    Ok(Budget {
        period: period.to_string(),
        limit_minor,
        spent_minor,
        remaining_minor: limit_minor - spent_minor,
        currency,
        state: state_for(spent_minor, limit_minor),
    })
}

/// Total the cost of a set of runs. Returns an error rather than silently
/// skipping a run whose currency differs from the rest.
pub fn total_minor(costs: &[(i64, Currency)]) -> Result<(i64, Currency), BudgetError> {
    let Some((_, currency)) = costs.first().copied() else {
        return Ok((0, Currency::Eur));
    };
    let mut total = 0;
    for (amount, each) in costs {
        if *each != currency {
            return Err(BudgetError::SpendNegative);
        }
        if *amount < 0 {
            return Err(BudgetError::SpendNegative);
        }
        total += amount;
    }
    Ok((total, currency))
}

/// Format minor units for display without dividing a currency amount.
pub fn format_minor(amount_minor: i64, currency: Currency) -> String {
    let symbol = match currency {
        Currency::Eur => "\u{20ac}",
        Currency::Usd => "$",
    };
    let sign = if amount_minor < 0 { "-" } else { "" };
    let abs = amount_minor.abs();
    format!("{sign}{symbol}{}.{:02}", abs / 100, abs % 100)
}

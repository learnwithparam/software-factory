use budget::{assess, format_minor, state_for, total_minor, Budget, BudgetError, Currency, State};

#[test]
fn spent_plus_remaining_always_equals_the_limit() {
    for spent in [0, 1, 4_999, 5_000, 39_999, 40_000, 49_999, 50_000, 73_000] {
        let b: Budget = assess("2026-09", 50_000, spent, Currency::Eur).unwrap();
        assert_eq!(
            b.spent_minor + b.remaining_minor,
            b.limit_minor,
            "invariant broken at spend {spent}"
        );
    }
}

#[test]
fn the_warning_starts_exactly_at_eighty_percent() {
    assert_eq!(state_for(39_999, 50_000), State::Under);
    assert_eq!(state_for(40_000, 50_000), State::Warning);
    assert_eq!(state_for(49_999, 50_000), State::Warning);
}

#[test]
fn reaching_the_limit_is_a_breach_not_a_warning() {
    assert_eq!(state_for(50_000, 50_000), State::Breached);
    assert_eq!(state_for(50_001, 50_000), State::Breached);
}

#[test]
fn the_threshold_holds_on_a_limit_that_does_not_divide_evenly() {
    // 80% of 333 is 266.4. Spending 266 is still under, 267 is a warning.
    assert_eq!(state_for(266, 333), State::Under);
    assert_eq!(state_for(267, 333), State::Warning);
}

#[test]
fn overspend_is_reported_rather_than_clamped() {
    let b = assess("2026-09", 50_000, 73_000, Currency::Eur).unwrap();
    assert_eq!(b.remaining_minor, -23_000);
    assert_eq!(b.state, State::Breached);
}

#[test]
fn a_zero_limit_is_refused() {
    assert_eq!(
        assess("2026-09", 0, 0, Currency::Eur),
        Err(BudgetError::LimitNotPositive)
    );
}

#[test]
fn negative_spend_is_refused() {
    assert_eq!(
        assess("2026-09", 100, -1, Currency::Eur),
        Err(BudgetError::SpendNegative)
    );
}

#[test]
fn a_period_that_is_not_a_calendar_month_is_refused() {
    for period in ["2026-9", "2026-13", "2026-00", "september", "2026/09", "2026-09-01"] {
        assert_eq!(
            assess(period, 100, 0, Currency::Eur),
            Err(BudgetError::PeriodMalformed),
            "accepted {period}"
        );
    }
}

#[test]
fn totalling_refuses_to_mix_currencies_rather_than_skipping_one() {
    let mixed = [(100, Currency::Eur), (100, Currency::Usd)];
    assert!(total_minor(&mixed).is_err());
}

#[test]
fn totalling_an_empty_set_is_zero() {
    assert_eq!(total_minor(&[]).unwrap(), (0, Currency::Eur));
}

#[test]
fn formatting_keeps_the_cents_a_float_would_lose() {
    assert_eq!(format_minor(1_999, Currency::Eur), "\u{20ac}19.99");
    assert_eq!(format_minor(5, Currency::Usd), "$0.05");
    assert_eq!(format_minor(0, Currency::Eur), "\u{20ac}0.00");
    assert_eq!(format_minor(-250, Currency::Eur), "-\u{20ac}2.50");
}

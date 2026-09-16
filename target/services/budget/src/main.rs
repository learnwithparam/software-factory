//! Report a budget as JSON on stdout.
//!
//! A command rather than a server: the console reads the ledger for runs and
//! calls this for the money, which keeps the money path small enough to read in
//! one sitting and easy to reason about when reviewing an agent's change to it.

use budget::{assess, format_minor, Currency};
use std::process::ExitCode;

fn escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [period, limit, spent, code] = args.as_slice() else {
        eprintln!("usage: budget-cli <period YYYY-MM> <limit-minor> <spent-minor> <EUR|USD>");
        return ExitCode::from(2);
    };

    let (Ok(limit_minor), Ok(spent_minor)) = (limit.parse::<i64>(), spent.parse::<i64>()) else {
        eprintln!("limit and spent must be whole numbers of minor units");
        return ExitCode::from(2);
    };

    let Some(currency) = Currency::parse(code) else {
        eprintln!("currency must be EUR or USD");
        return ExitCode::from(2);
    };

    match assess(period, limit_minor, spent_minor, currency) {
        Ok(budget) => {
            println!(
                "{{\"period\":\"{}\",\"limitMinor\":{},\"spentMinor\":{},\"remainingMinor\":{},\"currency\":\"{}\",\"state\":\"{}\"}}",
                escape(&budget.period),
                budget.limit_minor,
                budget.spent_minor,
                budget.remaining_minor,
                budget.currency.code(),
                budget.state.name(),
            );
            eprintln!(
                "{} of {} spent",
                format_minor(budget.spent_minor, budget.currency),
                format_minor(budget.limit_minor, budget.currency)
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error:?}");
            ExitCode::from(1)
        }
    }
}

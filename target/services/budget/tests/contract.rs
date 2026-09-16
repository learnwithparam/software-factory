//! The Rust side of the one shared definition.
//!
//! No JSON crate is pulled in for this. The schema is read as text and the two
//! lists it needs are extracted by scanning, which keeps the money path's
//! dependency list empty. A malformed schema fails loudly rather than yielding
//! an empty list that would make every assertion below pass for free.

use budget::{Currency, State};
use std::fs;
use std::path::PathBuf;

fn schema_text(name: &str) -> String {
    let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "..", "packages", "contracts", "schema", name]
        .iter()
        .collect();
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// The keys directly under `"properties"`, in declaration order.
fn properties(name: &str) -> Vec<String> {
    let text = schema_text(name);
    let start = text.find("\"properties\"").expect("schema declares no properties");
    let body = &text[start..];
    let mut depth = 0usize;
    let mut found = Vec::new();
    let mut chars = body.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            '"' if depth == 1 => {
                let rest = &body[i + 1..];
                let end = rest.find('"').expect("unterminated key");
                let key = &rest[..end];
                let after = rest[end + 1..].trim_start();
                if after.starts_with(':') {
                    found.push(key.to_string());
                }
            }
            _ => {}
        }
    }
    assert!(!found.is_empty(), "{name} yielded no property names");
    found
}

/// The values of the `enum` array belonging to one property.
fn enum_values(name: &str, property: &str) -> Vec<String> {
    let text = schema_text(name);
    // The name must be matched where it is *defined*, not where it is merely
    // listed. Matching the bare name found it inside "required" first and read
    // the enum belonging to a different property, which passed for the wrong reason.
    let needle = format!("\"{property}\":");
    let at = text
        .match_indices(&needle)
        .find(|(i, _)| text[i + needle.len()..].trim_start().starts_with('{'))
        .map(|(i, _)| i)
        .unwrap_or_else(|| panic!("{name} does not define a property {property}"));
    let rest = &text[at..];
    let open = rest.find("\"enum\"").expect("property declares no enum");
    let list_start = rest[open..].find('[').expect("enum is not a list") + open;
    let list_end = rest[list_start..].find(']').expect("unterminated enum") + list_start;
    let list = &rest[list_start + 1..list_end];
    let values: Vec<String> = list
        .split(',')
        .map(|v| v.trim().trim_matches('"').to_string())
        .filter(|v| !v.is_empty())
        .collect();
    assert!(!values.is_empty(), "{name}.{property} yielded no values");
    values
}

fn sorted(mut values: Vec<String>) -> Vec<String> {
    values.sort();
    values
}

#[test]
fn budget_has_exactly_the_fields_the_schema_declares() {
    // The struct's fields are snake case; the contract is camel case. Listing the
    // mapping here is what makes a rename on either side fail rather than pass.
    let ours = vec![
        "period".to_string(),
        "limitMinor".to_string(),
        "spentMinor".to_string(),
        "remainingMinor".to_string(),
        "currency".to_string(),
        "state".to_string(),
    ];
    assert_eq!(sorted(ours), sorted(properties("budget.schema.json")));
}

#[test]
fn every_state_the_schema_allows_is_a_state_we_can_produce() {
    let ours: Vec<String> = [State::Under, State::Warning, State::Breached]
        .iter()
        .map(|s| s.name().to_string())
        .collect();
    assert_eq!(sorted(ours), sorted(enum_values("budget.schema.json", "state")));
}

#[test]
fn every_currency_the_schema_allows_parses() {
    for code in enum_values("budget.schema.json", "currency") {
        assert!(
            Currency::parse(&code).is_some(),
            "the contract allows {code} and the money path cannot read it"
        );
    }
}

#[test]
fn a_currency_the_schema_does_not_allow_is_refused() {
    assert!(Currency::parse("GBP").is_none());
}

use pretty_assertions::assert_eq;

use super::*;

#[test]
fn split_takes_the_leading_meta_literal() {
    let script = "// review\nexport const meta = {\n  name: 'review',\n  description: 'a } in a string',\n  phases: [{ title: 'Find' }],\n};\nphase('Find')\nreturn 1\n";
    let split = split(script).expect("meta");
    assert_eq!(
        split.meta,
        "{\n  name: 'review',\n  description: 'a } in a string',\n  phases: [{ title: 'Find' }],\n}"
    );
    assert_eq!(split.body, "\nphase('Find')\nreturn 1\n");
}

#[test]
fn split_rejects_scripts_without_a_leading_meta() {
    assert!(split("const x = 1;\nexport const meta = { name: 'a' };").is_err());
    assert!(split("export const metadata = { name: 'a' };").is_err());
    assert!(split("export const meta = foo();").is_err());
    assert!(split("export const meta = { name: 'a'").is_err());
}

#[test]
fn determinism_check_ignores_strings_and_comments() {
    assert!(check_determinism("const t = Date.now();").is_err());
    assert!(check_determinism("const r = Math.random ();").is_err());
    assert!(check_determinism("const d = new Date();").is_err());
    assert!(check_determinism("const d = new Date(args.now);").is_ok());
    assert!(check_determinism("agent('call Date.now() later') // Math.random()").is_ok());
}

#[test]
fn check_text_rejects_invisible_characters() {
    assert!(check_text("return 1\n\tok").is_ok());
    assert!(check_text(&format!("return {}1", char::from_u32(0x202E).unwrap())).is_err());
    assert!(check_text(&format!("a{}b", char::from_u32(7).unwrap())).is_err());
    assert!(check_text(&"x".repeat(MAX_SCRIPT_BYTES + 1)).is_err());
}

#[test]
fn run_source_keeps_the_prelude_on_one_line() {
    let source = run_source("return args.n", &serde_json::json!({"n": 2}), 8);
    let first = source.lines().next().expect("first line");
    assert!(first.contains("globalThis.agent"));
    assert!(first.contains("const __wfMaxInFlight = 8;"));
    assert!(first.ends_with("await __wfFinish(async () => {"));
    assert_eq!(source.lines().nth(1), Some("return args.n"));
}

#[test]
fn slug_makes_file_names() {
    assert_eq!(slug("Find Flaky Tests!"), "find-flaky-tests");
    assert_eq!(slug("评审"), "workflow");
}

//! Static handling of workflow scripts: the `meta` literal, determinism checks and the
//! module source handed to the code-mode host.

/// Largest script accepted inline or from disk.
pub(super) const MAX_SCRIPT_BYTES: usize = 524_288;

const PRELUDE: &str = include_str!("prelude.js");

/// A script split into its leading `meta` literal and the body after it.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct SplitScript<'a> {
    pub(super) meta: &'a str,
    pub(super) body: &'a str,
}

/// Rejects text a reviewer could not read: control and invisible format characters.
pub(super) fn check_text(script: &str) -> Result<(), String> {
    if script.len() > MAX_SCRIPT_BYTES {
        return Err(format!(
            "workflow script is {} bytes; the limit is {MAX_SCRIPT_BYTES}",
            script.len()
        ));
    }
    match script.chars().find(|c| {
        (c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
    }) {
        Some(c) => Err(format!(
            "workflow script contains the control or invisible character U+{:04X}",
            c as u32
        )),
        None => Ok(()),
    }
}

/// Finds `export const meta = { ... }` as the first statement and returns the literal.
pub(super) fn split(script: &str) -> Result<SplitScript<'_>, String> {
    const MISSING: &str =
        "the script must begin with `export const meta = { name, description, ... }`";
    let mut cursor = skip_trivia(script, 0);
    for word in ["export", "const", "meta"] {
        let tail = &script[cursor..];
        if !tail.starts_with(word)
            || tail[word.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '$')
        {
            return Err(MISSING.to_string());
        }
        cursor = skip_trivia(script, cursor + word.len());
    }
    if !script[cursor..].starts_with('=') {
        return Err(MISSING.to_string());
    }
    cursor = skip_trivia(script, cursor + 1);
    if !script[cursor..].starts_with('{') {
        return Err("`meta` must be an object literal".to_string());
    }
    let end = matching_brace(script, cursor)?;
    let meta = &script[cursor..=end];
    let mut after = skip_trivia(script, end + 1);
    if script[after..].starts_with(';') {
        after += 1;
    }
    Ok(SplitScript {
        meta,
        body: &script[after..],
    })
}

/// Rejects nondeterministic calls a resume could not replay (inline scripts only).
pub(super) fn check_determinism(body: &str) -> Result<(), String> {
    let code = strip_strings_and_comments(body);
    let compact: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    for (needle, what) in [
        ("Date.now(", "Date.now()"),
        ("Math.random(", "Math.random()"),
        ("newDate()", "new Date() without arguments"),
    ] {
        if compact.contains(needle) {
            return Err(format!(
                "{what} is not available in workflow scripts (it would break resume); pass timestamps in through `args` and vary prompts by index instead"
            ));
        }
    }
    Ok(())
}

/// Module source for the meta cell: prints the literal as JSON.
pub(super) fn meta_source(meta: &str) -> String {
    format!("text(JSON.stringify(({meta})));")
}

/// Module source for the run: prelude on the first line, then the body.
pub(super) fn run_source(body: &str, args: &serde_json::Value, max_in_flight: usize) -> String {
    let prelude: String = PRELUDE
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let args =
        serde_json::to_string(&serde_json::to_string(args).unwrap_or_else(|_| "null".into()))
            .unwrap_or_else(|_| "\"null\"".into());
    format!(
        "const __wfArgsJson = {args}; const __wfMaxInFlight = {max_in_flight}; {prelude} await __wfFinish(async () => {{\n{body}\n}});\n"
    )
}

/// Lowercase slug of a workflow name for file names.
pub(super) fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "workflow".to_string()
    } else {
        out
    }
}

fn skip_trivia(text: &str, mut at: usize) -> usize {
    let bytes = text.as_bytes();
    loop {
        while at < bytes.len() && (bytes[at] as char).is_ascii_whitespace() {
            at += 1;
        }
        if text[at..].starts_with("//") {
            at = text[at..].find('\n').map_or(text.len(), |n| at + n + 1);
        } else if text[at..].starts_with("/*") {
            at = text[at + 2..]
                .find("*/")
                .map_or(text.len(), |n| at + 2 + n + 2);
        } else {
            return at;
        }
    }
}

/// Index of the `}` closing the `{` at `open`, skipping strings, templates and comments.
fn matching_brace(text: &str, open: usize) -> Result<usize, String> {
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            b'{' | b'[' | b'(' => depth += 1,
            b'}' | b']' | b')' => {
                depth -= 1;
                if depth == 0 {
                    return Ok(i);
                }
            }
            b'"' | b'\'' | b'`' => i = skip_quoted(bytes, i)?,
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                i = text[i..].find('\n').map_or(bytes.len(), |n| i + n);
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = text[i + 2..]
                    .find("*/")
                    .map(|n| i + 2 + n + 1)
                    .ok_or("unterminated comment in `meta`")?;
            }
            _ => {}
        }
        i += 1;
    }
    Err("unterminated `meta` literal".to_string())
}

/// Index of the closing quote for the quote at `start`.
fn skip_quoted(bytes: &[u8], start: usize) -> Result<usize, String> {
    let quote = bytes[start];
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 1,
            c if c == quote => return Ok(i),
            b'\n' if quote != b'`' => return Err("unterminated string in `meta`".to_string()),
            _ => {}
        }
        i += 1;
    }
    Err("unterminated string in `meta`".to_string())
}

/// Blanks out string, template and comment contents so code scans skip them.
fn strip_strings_and_comments(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' | b'`' => {
                let end = skip_quoted(bytes, i).unwrap_or(bytes.len() - 1);
                out.extend_from_slice(b"\"\"");
                i = end + 1;
                continue;
            }
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                i = text[i..].find('\n').map_or(bytes.len(), |n| i + n);
                continue;
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i = text[i + 2..]
                    .find("*/")
                    .map_or(bytes.len(), |n| i + 2 + n + 2);
                out.push(b' ');
                continue;
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
#[path = "script_tests.rs"]
mod tests;

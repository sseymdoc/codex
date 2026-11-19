// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of redact.ts). The expectations
// are Claude Desktop 2.42304.0.0's own output (cccc2cf0a Nv over shared-104 Xs / sc, shared-0 rF).
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSecret, redactSecrets, taskText } from "./redact.ts";

const ch = (...codes) => String.fromCodePoint(...codes);
const dots = (n) => ch(0x2022).repeat(n);
/** A secret as Claude masks it: its first 8 characters kept, the rest bullets. */
const masked = (secret) => secret.slice(0, 8) + dots(secret.length - 8);

test("a plan step's secrets are masked, their first 8 characters kept", () => {
  const key = "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv";
  assert.equal(taskText(`Set **ANTHROPIC_API_KEY** to \`${key}\` first`), `Set **ANTHROPIC_API_KEY** to \`${masked(key)}\` first`);
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  assert.equal(taskText(`Bearer ${jwt}`), `Bearer ${masked(jwt)}`);
  // A hidden character doesn't hide one; it stays where it was, shown.
  assert.equal(taskText(`token ghp_${ch(0x200b)}AbCdEfGhIjKlMnOpQrStUvWx`), `token ghp_${ch(0xfffd)}AbCd${dots(20)}`);
  // Too short, glued to a word, or only a prefix: not a secret.
  const plain = "Use the `sk-proj-` prefix, not sk-1234; task-ant-api03-AbCdEfGhIjKlMnOpQrStUv stays";
  assert.equal(taskText(plain), plain);
});

test("a private key keeps its armor lines; one left open is cut off", () => {
  assert.equal(
    taskText("key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nq83vEjUd\n-----END RSA PRIVATE KEY-----\ndone"),
    `key:\n-----BEGIN RSA PRIVATE KEY-----\n${dots(16)}\n${dots(8)}\n-----END RSA PRIVATE KEY-----\ndone`,
  );
  assert.equal(taskText("Rotate the deploy key\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA"), "Rotate the deploy key\n");
});

test("control characters show as their pictures, other invisible ones as U+FFFD", () => {
  assert.equal(taskText(`a\rb${ch(1)}c${ch(0x7f)}d\te\nf`), `a${ch(0x240d)}b${ch(0x2401)}c${ch(0x2421)}d\te\nf`);
  // Emoji keep their joiners and variation selectors; a word joiner stays only inside a word.
  const wj = ch(0x2060);
  assert.equal(
    taskText(`${ch(0x1f469, 0x200d, 0x1f4bb)} ${ch(0x2764, 0xfe0f)} a${ch(0x200b)}b foo${wj}bar foo ${wj} bar`),
    `${ch(0x1f469, 0x200d, 0x1f4bb)} ${ch(0x2764, 0xfe0f)} a${ch(0xfffd)}b foo${wj}bar foo ${ch(0xfffd)} bar`,
  );
});

test("OpenAI service-account and admin keys are masked too", () => {
  for (const key of ["sk-svcacct-AbCdEfGhIjKlMnOpQrStUv_x-y", "sk-admin-AbCdEfGhIjKlMnOpQrStUv"]) assert.equal(taskText(`key ${key} end`), `key ${masked(key)} end`);
});

test("hasSecret finds a secret in text longer than one 256KB window", () => {
  const filler = "a ".repeat(200000);
  assert.equal(hasSecret(filler), false);
  assert.equal(hasSecret(`${filler}ghp_AbCdEfGhIjKlMnOpQrStUvWx`), true);
});

test("a word glued to a secret's prefix stays a word where the second window starts", () => {
  // The second window starts at 262144 - 8192, right at the "g".
  const text = `${" ".repeat(262144 - 8192 - 1)}aghp_AbCdEfGhIjKlMnOpQrStUvWx${" ".repeat(262144)}`;
  assert.equal(hasSecret(text), false);
  assert.equal(redactSecrets(text), text);
});

// Code themes (Settings → Codex → 代码外观): the list Claude Desktop 2.42304.0.0 offers (c5d464fa3 k),
// each resolved for codex-ui's highlight.js classes. Generated from the themes the app bundles
// (claude-light / claude-dark as c5d464fa3 builds them, the rest Shiki's tm-themes in cd14a9327 and
// @pierre/theme) the way Claude's own editor theme reads them (cbd02b8f2 ea: the longest scope prefix
// wins, and each property takes the first of its scopes that resolves, as na() walks Qi), minus
// descendant selectors, which need a context the classes do not carry. Background and ink are Shiki's
// (normalizeTheme); the terminal palette is cf718f694 we(): the theme's terminal colors over Claude's
// own, editor colors standing in. Theme colors © their authors (MIT).
// Scopes: comment comment, string string, number constant.numeric, keyword keyword, function
// entity.name.function | support.function | variable.function, type entity.name.type | support.type
// | storage.type, tag entity.name.tag | support.class.component, attr entity.other.attribute-name |
// support.type.property-name, variable variable.parameter | variable.other.local | variable,
// property variable.other.property, punctuation punctuation, regexp string.regexp | string,
// inserted markup.inserted.diff | markup.inserted, deleted markup.deleted.diff | markup.deleted.

export type CodeThemeMode = "light" | "dark";

/** What a theme sets, as --code-<mode>-<name> on <html> (Settings.tsx applyCodeThemes). */
const CODE_VARS = ["bg", "fg", "comment", "comment-style", "string", "number", "keyword", "function", "type", "tag", "attr", "variable", "property", "punctuation", "regexp", "inserted", "deleted"] as const;

/** xterm's palette (Terminal.tsx). */
const TERM_KEYS = ["background", "foreground", "cursor", "cursorAccent", "selectionBackground", "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const;

export interface CodeTheme {
  value: string;
  label: string;
  mode: CodeThemeMode;
  code: Record<(typeof CODE_VARS)[number], string>;
  term: Record<(typeof TERM_KEYS)[number], string>;
}

const zip = <K extends string>(keys: readonly K[], values: string) => {
  const list = values.split(" ");
  return Object.fromEntries(keys.map((key, index) => [key, list[index]])) as Record<K, string>;
};

const theme = (value: string, label: string, mode: CodeThemeMode, code: string, term: string): CodeTheme => ({ value, label, mode, code: zip(CODE_VARS, code), term: zip(TERM_KEYS, term) });

export const CODE_THEMES: CodeTheme[] = [
  theme("claude-light", "Claude Light", "light", "#ffffff #1a1a1a #999999 italic #1e9e3c #cd2054 #c5621b #0073e6 #8e6bd9 #c5621b #0073e6 #1a1a1a #1a1a1a #737373 #98801f #1e9e3c #ff3a30", "#ffffff #1a1a1a #0073e6 #ffffff #0073e640 #1a1a1a #ff3a30 #1e9e3c #98801f #0073e6 #cd2054 #8e6bd9 #999999 #666666 #ff5047 #1e9e3c #98801f #0078f0 #cd2054 #8e6bd9 #d6d6d6"),
  theme("claude-dark", "Claude Dark", "dark", "#1a1a19 #eaecf0 #818898 normal #9be963 #5eeded #cc7bf4 #70b8ff #fbad60 #f47b85 #f0757f #f7ab5f #eaecf0 #d3d7de #96e35f #9be963 #f47b85", "#1a1a19 #eaecf0 #0099ff #1a1a19 #0099ff4d #262626 #ff3a30 #32d74b #ffd014 #0099ff #ff2c56 #b796ff #a6a6a6 #525252 #ff5047 #32d74b #ffd014 #0087ee #ff2c56 #b796ff #ededed"),
  theme("github-light", "GitHub Light", "light", "#fff #24292e #6a737d normal #032f62 #005cc5 #d73a49 #6f42c1 #6f42c1 #22863a #6f42c1 #e36209 #24292e #24292e #032f62 #22863a #b31d28", "#fff #586069 #005cc5 #d1d5da #0073e640 #24292e #d73a49 #28a745 #dbab09 #0366d6 #5a32a3 #1b7c83 #6a737d #959da5 #cb2431 #22863a #b08800 #005cc5 #5a32a3 #3192aa #d1d5da"),
  theme("github-dark", "GitHub Dark", "dark", "#24292e #e1e4e8 #6a737d normal #9ecbff #79b8ff #f97583 #b392f0 #b392f0 #85e89d #b392f0 #ffab70 #e1e4e8 #e1e4e8 #dbedff #85e89d #fdaeb7", "#24292e #d1d5da #79b8ff #586069 #0099ff4d #586069 #ea4a5a #34d058 #ffea7f #2188ff #b392f0 #39c5cf #d1d5da #959da5 #f97583 #85e89d #ffea7f #79b8ff #b392f0 #56d4dd #fafbfc"),
  theme("github-dark-dimmed", "GitHub Dark Dimmed", "dark", "#22272e #adbac7 #768390 normal #96d0ff #6cb6ff #f47067 #dcbdfb #f69d50 #8ddb8c #6cb6ff #f69d50 #adbac7 #adbac7 #96d0ff #8ddb8c #ff938a", "#22272e #adbac7 #adbac7 #22272e #0099ff4d #545d68 #f47067 #57ab5a #c69026 #539bf5 #b083f0 #39c5cf #909dab #636e7b #ff938a #6bc46d #daaa3f #6cb6ff #dcbdfb #56d4dd #cdd9e5"),
  theme("pierre-light", "Pierre Light", "light", "#ffffff #0a0a0a #737373 normal #199f43 #1ca1c7 #d32a61 #693acf #a631be #d5512f #18a46c #636363 #d47628 #636363 #17a5af #199f43 #d5512f", "#f5f5f5 #525252 #525252 #f5f5f5 #0073e640 #1d1d1d #d52c36 #18a46c #d5a910 #1a85d4 #bd2e90 #1ca1c7 #bcbcbc #1d1d1d #d52c36 #77a42a #d5a910 #1a85d4 #bd2e90 #1ca1c7 #bcbcbc"),
  theme("pierre-dark", "Pierre Dark", "dark", "#0a0a0a #fafafa #737373 normal #5ecc71 #68cdf2 #ff678d #9d6afb #d568ea #ff855e #60d199 #a3a3a3 #ffa359 #636363 #64d1db #5ecc71 #ff855e", "#171717 #a3a3a3 #a3a3a3 #171717 #0099ff4d #171717 #ff2e3f #0dbe4e #ffca00 #009fff #e130ac #08c0ef #bcbcbc #171717 #ff2e3f #86c427 #ffca00 #009fff #e130ac #08c0ef #bcbcbc"),
  theme("one-dark-pro", "One Dark Pro", "dark", "#282c34 #abb2bf #7f848e italic #98c379 #d19a66 #c678dd #61afef #e5c07b #e06c75 #d19a66 #e06c75 #e06c75 #abb2bf #e06c75 #98c379 #e06c75", "#282c34 #abb2bf #abb2bf #282c34 #abb2bf30 #3f4451 #e05561 #8cc265 #d18f52 #4aa5f0 #c162de #42b3c2 #d7dae0 #4f5666 #ff616e #a5e075 #f0a45d #4dc4ff #de73ff #4cd1e0 #e6e6e6"),
  theme("one-light", "One Light", "light", "#fafafa #383a42 #a0a1a7 italic #50a14f #986801 #a626a4 #4078f2 #c18401 #e45649 #986801 #383a42 #e45649 #383a42 #0184bc #50a14f #e45649", "#fafafa #383a42 #383a42 #fafafa #0073e640 #1a1a1a #ff3a30 #1e9e3c #98801f #0073e6 #cd2054 #8e6bd9 #999999 #666666 #ff5047 #1e9e3c #98801f #0078f0 #cd2054 #8e6bd9 #d6d6d6"),
  theme("dracula", "Dracula", "dark", "#282a36 #f8f8f2 #6272a4 normal #f1fa8c #bd93f9 #ff79c6 #50fa7b #8be9fd #ff79c6 #50fa7b #ffb86c #f8f8f2 #f8f8f2 #f1fa8c #50fa7b #ff5555", "#282a36 #f8f8f2 #f8f8f2 #282a36 #0099ff4d #21222c #ff5555 #50fa7b #f1fa8c #bd93f9 #ff79c6 #8be9fd #f8f8f2 #6272a4 #ff6e6e #69ff94 #ffffa5 #d6acff #ff92df #a4ffff #ffffff"),
  theme("dracula-soft", "Dracula Soft", "dark", "#282a36 #f6f6f4 #7b7f8b normal #e7ee98 #bf9eee #f286c4 #62e884 #97e1f1 #f286c4 #62e884 #ffb86c #f6f6f4 #f6f6f4 #e7ee98 #62e884 #ee6666", "#282a36 #f6f6f4 #f6f6f4 #282a36 #0099ff4d #262626 #ee6666 #62e884 #e7ee98 #bf9eee #f286c4 #97e1f1 #f6f6f4 #7b7f8b #f07c7c #78f09a #f6f6ae #d6b4f7 #f49dda #adf6f6 #ffffff"),
  theme("catppuccin-latte", "Catppuccin Latte", "light", "#eff1f5 #4c4f69 #7c7f93 italic #40a02b #fe640b #8839ef #1e66f5 #df8e1d #1e66f5 #df8e1d #e64553 #4c4f69 #7c7f93 #40a02b #40a02b #d20f39", "#eff1f5 #4c4f69 #dc8a78 #eff1f5 #acb0be #5c5f77 #d20f39 #40a02b #df8e1d #1e66f5 #ea76cb #179299 #acb0be #6c6f85 #de293e #49af3d #eea02d #456eff #fe85d8 #2d9fa8 #bcc0cc"),
  theme("catppuccin-mocha", "Catppuccin Mocha", "dark", "#1e1e2e #cdd6f4 #9399b2 italic #a6e3a1 #fab387 #cba6f7 #89b4fa #f9e2af #89b4fa #f9e2af #eba0ac #cdd6f4 #9399b2 #a6e3a1 #a6e3a1 #f38ba8", "#1e1e2e #cdd6f4 #f5e0dc #1e1e2e #585b70 #45475a #f38ba8 #a6e3a1 #f9e2af #89b4fa #f5c2e7 #94e2d5 #a6adc8 #585b70 #f37799 #89d88b #ebd391 #74a8fc #f2aede #6bd7ca #bac2de"),
  theme("nord", "Nord", "dark", "#2e3440ff #d8dee9ff #616e88 normal #a3be8c #b48ead #81a1c1 #88c0d0 #8fbcbb #81a1c1 #8fbcbb #d8dee9 #d8dee9 #eceff4 #ebcb8b #a3be8c #bf616a", "#2e3440 #d8dee9 #d8dee9 #2e3440 #0099ff4d #3b4252 #bf616a #a3be8c #ebcb8b #81a1c1 #b48ead #88c0d0 #e5e9f0 #4c566a #bf616a #a3be8c #ebcb8b #81a1c1 #b48ead #8fbcbb #eceff4"),
  theme("solarized-dark", "Solarized Dark", "dark", "#002b36 #839496 #586e75 italic #2aa198 #d33682 #859900 #268bd2 #cb4b16 #268bd2 #93a1a1 #268bd2 #268bd2 #839496 #dc322f #859900 #dc322f", "#002b36 #839496 #839496 #002b36 #0099ff4d #073642 #dc322f #859900 #b58900 #268bd2 #d33682 #2aa198 #eee8d5 #002b36 #cb4b16 #586e75 #657b83 #839496 #6c71c4 #93a1a1 #fdf6e3"),
  theme("solarized-light", "Solarized Light", "light", "#fdf6e3 #657b83 #93a1a1 italic #2aa198 #d33682 #859900 #268bd2 #cb4b16 #268bd2 #93a1a1 #268bd2 #268bd2 #657b83 #dc322f #859900 #dc322f", "#fdf6e3 #657b83 #657b83 #fdf6e3 #0073e640 #073642 #dc322f #859900 #b58900 #268bd2 #d33682 #2aa198 #eee8d5 #002b36 #cb4b16 #586e75 #657b83 #839496 #6c71c4 #93a1a1 #fdf6e3"),
  theme("vitesse-dark", "Vitesse Dark", "dark", "#121212 #dbd7caee #758575dd normal #c98a7d #4c9a91 #4d9375 #80a665 #5da994 #4d9375 #bd976a #bd976a #bd976a #666666 #c4704f #85e89d #fdaeb7", "#121212 #dbd7caee #dbd7caee #121212 #eeeeee18 #393a34 #cb7676 #4d9375 #e6cc77 #6394bf #d9739f #5eaab5 #dbd7ca #777777 #cb7676 #4d9375 #e6cc77 #6394bf #d9739f #5eaab5 #ffffff"),
  theme("vitesse-light", "Vitesse Light", "light", "#ffffff #393a34 #a0ada0 normal #b56959 #2f798a #1e754f #59873a #2e8f82 #1e754f #b07d48 #b07d48 #b07d48 #999999 #ab5e3f #22863a #b31d28", "#ffffff #393a34 #393a34 #ffffff #22222218 #121212 #ab5959 #1e754f #bda437 #296aa3 #a13865 #2993a3 #dbd7ca #aaaaaa #ab5959 #1e754f #bda437 #296aa3 #a13865 #2993a3 #dddddd"),
  theme("min-dark", "Min Dark", "dark", "#1f1f1f #b392f0 #6b737c normal #9db1c5 #f8f8f8 #f97583 #b392f0 #b392f0 #ffab70 #b392f0 #b392f0 #b392f0 #b392f0 #ffab70 #b392f0 #b392f0", "#1f1f1f #eaecf0 #eaecf0 #1f1f1f #0099ff4d #262626 #ff3a30 #32d74b #ffd014 #0099ff #ff2c56 #b796ff #a6a6a6 #5c5c5c #ff5047 #32d74b #ffd014 #0087ee #ff2c56 #b796ff #ededed"),
  theme("min-light", "Min Light", "light", "#ffffff #24292eff #c2c3c5 normal #2b5581 #1976d2 #d32f2f #6f42c1 #6f42c1 #22863a #6f42c1 #24292eff #24292eff #24292eff #22863a #24292eff #24292eff", "#fff #212121 #212121 #fff #0073e640 #333 #d32f2f #77cc00 #f29718 #e0e0e0 #9966cc #4dbf99 #c7c7c7 #a1a1a1 #d6656a #a3d900 #e7c547 #6871ff #a37acc #57d9ad #7e7e7e"),
  theme("monokai", "Monokai", "dark", "#272822 #f8f8f2 #88846f normal #e6db74 #ae81ff #f92672 #a6e22e #a6e22e #f92672 #a6e22e #fd971f #f8f8f2 #f8f8f2 #e6db74 #a6e22e #f92672", "#272822 #f8f8f2 #f8f8f2 #272822 #0099ff4d #333333 #c4265e #86b42b #b3b42b #6a7ec8 #8c6bc8 #56adbc #e3e3dd #666666 #f92672 #a6e22e #e2e22e #819aff #ae81ff #66d9ef #f8f8f2"),
  theme("tokyo-night", "Tokyo Night", "dark", "#1a1b26 #a9b1d6 #51597d italic #9ece6a #ff9e64 #bb9af7 #7aa2f7 #c0caf5 #f7768e #bb9af7 #e0af68 #7dcfff #89ddff #b4f9f8 #449dab #914c54", "#16161e #787c99 #787c99 #16161e #515c7e4d #363b54 #f7768e #73daca #e0af68 #7aa2f7 #bb9af7 #7dcfff #787c99 #363b54 #f7768e #73daca #e0af68 #7aa2f7 #bb9af7 #7dcfff #acb0d0"),
  theme("night-owl", "Night Owl", "dark", "#011627 #d6deeb #637777 italic #ecc48d #f78c6c #c792ea #82aaff #c5e478 #caece6 #c5e478 #d7dbe0 #baebe2 #d6deeb #5ca7e4 #c5e478ff #ef535090", "#011627 #d6deeb #d6deeb #234d70 #1b90dd4d #011627 #ef5350 #22da6e #c5e478 #82aaff #c792ea #21c7a8 #ffffff #575656 #ef5350 #22da6e #ffeb95 #82aaff #c792ea #7fdbca #ffffff"),
  theme("rose-pine", "Rosé Pine", "dark", "#191724 #e0def4 #6e6a86 italic #f6c177 #ebbcba #31748f #ebbcba #9ccfd8 #9ccfd8 #c4a7e7 #c4a7e7 #e0def4 #908caa #f6c177 #9ccfd8 #eb6f92", "#191724 #e0def4 #6e6a86 #e0def4 #6e6a8633 #26233a #eb6f92 #31748f #f6c177 #9ccfd8 #c4a7e7 #ebbcba #e0def4 #908caa #eb6f92 #31748f #f6c177 #9ccfd8 #c4a7e7 #ebbcba #e0def4"),
  theme("rose-pine-dawn", "Rosé Pine Dawn", "light", "#faf4ed #575279 #9893a5 italic #ea9d34 #d7827e #286983 #d7827e #56949f #56949f #907aa9 #907aa9 #575279 #797593 #ea9d34 #56949f #b4637a", "#faf4ed #575279 #9893a5 #575279 #6e6a8614 #f2e9e1 #b4637a #286983 #ea9d34 #56949f #907aa9 #d7827e #575279 #797593 #b4637a #286983 #ea9d34 #56949f #907aa9 #d7827e #575279"),
  theme("ayu-dark", "Ayu Dark", "dark", "#0d1017 #bfbdb6 #5a6673 italic #aad94c #d2a6ff #ff8f40 #ffb454 #59c2ff #39bae6 #ffb454 #d2a6ff #bfbdb6 #bfbdb6 #95e6cb #70bf56 #f26d78", "#0d1017 #bfbdb6 #bfbdb6 #0d1017 #0099ff4d #1b1f29 #f06b73 #70bf56 #fdb04c #4fbfff #d0a1ff #93e2c8 #c7c7c7 #686868 #f07178 #aad94c #ffb454 #59c2ff #d2a6ff #95e6cb #ffffff"),
  theme("slack-dark", "Slack Dark", "dark", "#222222 #e6e6e6 #6a9955 normal #ce9178 #b5cea8 #569cd6 #dcdcaa #4ec9b0 #569cd6 #9cdcfe #9cdcfe #9cdcfe #e6e6e6 #d16969 #b5cea8 #ce9178", "#222222 #e6e6e6 #e6e6e6 #222222 #0099ff4d #262626 #ff3a30 #32d74b #ffd014 #0099ff #ff2c56 #b796ff #a6a6a6 #525252 #ff5047 #32d74b #ffd014 #0087ee #ff2c56 #b796ff #ededed"),
  theme("slack-ochin", "Slack Ochin", "light", "#fff #002339 #357b42 italic #a44185 #174781 #7b30d0 #7eb233 #0444ac #0444ac #df8618 #b1108e #2f86d2 #002339 #a44185 #002339 #002339", "#fff #161f26 #161f26 #fff #0006 #000000 #e53935 #91b859 #ffb62c #6182b8 #7c4dff #39adb5 #ffffff #90a4ae #e53935 #91b859 #ffb62c #6182b8 #7c4dff #39adb5 #ffffff"),
];

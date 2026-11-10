/**
 * Compiles a maths expression into a fast `(x) => number` closure.
 *
 * There is deliberately no `eval` or `new Function` here. The source is
 * tokenised, parsed into an AST, and only the fixed tables below are
 * reachable from the result. Anything else throws, so a graph block can
 * never execute code.
 */

export class ExpressionError extends Error {}

/**
 * A compiled expression. `scope` supplies values for any named parameters the
 * expression references (the sliders in a graph); `x` is the independent
 * variable. Callers that have no parameters can ignore the second argument.
 */
export type Compiled = (x: number, scope?: Record<string, number>) => number;

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string };

type Node =
  | { kind: "number"; value: number }
  | { kind: "constant"; name: string }
  | { kind: "variable" }
  | { kind: "param"; name: string }
  | { kind: "unary"; op: "-" | "+"; operand: Node }
  | { kind: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] };

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  csc: (a) => 1 / Math.sin(a),
  sec: (a) => 1 / Math.cos(a),
  cot: (a) => 1 / Math.tan(a),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  mod: (a, b) => a % b,
  hypot: Math.hypot,
};

const REPLACEMENTS: Record<string, string> = {
  "\u2212": "-",
  "\u00d7": "*",
  "\u00f7": "/",
  "\u03c0": "pi",
  "\u221a": "sqrt",
};

export function compileExpression(source: string): Compiled {
  const ast = parseExpressionTree(source);
  return (x: number, scope?: Record<string, number>) => evaluate(ast, x, scope);
}

/**
 * Parses `source` into the internal AST. Shared by the evaluator and the LaTeX
 * serializer so both accept exactly the same language.
 */
function parseExpressionTree(source: string): Node {
  const tokens = tokenize(source);
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const peekOp = (): string | null => {
    const t = tokens[pos];
    return t && t.kind === "op" ? t.value : null;
  };

  function expectOp(op: string): void {
    if (peekOp() !== op) throw new ExpressionError(`Expected "${op}".`);
    pos++;
  }

  function startsPrimary(): boolean {
    const t = peek();
    if (!t) return false;
    if (t.kind === "number" || t.kind === "name") return true;
    return t.kind === "op" && t.value === "(";
  }

  function parseExpression(): Node {
    let node = parseTerm();
    for (;;) {
      const op = peekOp();
      if (op === "+" || op === "-") {
        pos++;
        node = { kind: "binary", op, left: node, right: parseTerm() };
      } else return node;
    }
  }

  function parseTerm(): Node {
    let node = parseUnary();
    for (;;) {
      const op = peekOp();
      if (op === "*" || op === "/") {
        pos++;
        node = { kind: "binary", op, left: node, right: parseUnary() };
      } else if (startsPrimary()) {
        // Implicit multiplication: 2x, 3(x+1), 2sin(x), 4pi.
        node = { kind: "binary", op: "*", left: node, right: parseUnary() };
      } else return node;
    }
  }

  function parseUnary(): Node {
    const op = peekOp();
    if (op === "-" || op === "+") {
      pos++;
      return { kind: "unary", op, operand: parseUnary() };
    }
    return parsePower();
  }

  function parsePower(): Node {
    const base = parsePrimary();
    if (peekOp() === "^") {
      pos++;
      // Right associative, and the exponent may carry its own sign.
      return { kind: "binary", op: "^", left: base, right: parseUnary() };
    }
    return base;
  }

  function parsePrimary(): Node {
    const t = tokens[pos++];
    if (!t) throw new ExpressionError("Unexpected end of expression.");

    if (t.kind === "number") return { kind: "number", value: t.value };

    if (t.kind === "name") {
      const name = t.value.toLowerCase();
      // Only known functions take arguments. "x(x+1)" is implicit multiplication.
      if (peekOp() === "(" && name in FUNCTIONS) {
        pos++;
        const args: Node[] = [];
        if (peekOp() !== ")") {
          args.push(parseExpression());
          while (peekOp() === ",") {
            pos++;
            args.push(parseExpression());
          }
        }
        expectOp(")");
        return { kind: "call", name, args };
      }
      if (name === "x") return { kind: "variable" };
      // Kept symbolic rather than folded to a number, so LaTeX can emit \pi and
      // e instead of a long decimal.
      if (name in CONSTANTS) return { kind: "constant", name };
      // Any other single letter is a slider parameter, e.g. `a` in a sin(bx).
      // Multi-letter unknowns are almost always a typo, so reject those.
      if (/^[a-z]$/.test(name)) return { kind: "param", name };
      throw new ExpressionError(`Unknown name "${t.value}".`);
    }

    if (t.value === "(") {
      const inner = parseExpression();
      expectOp(")");
      return inner;
    }

    throw new ExpressionError(`Unexpected "${t.value}".`);
  }

  const ast = parseExpression();
  if (pos < tokens.length) throw new ExpressionError("Unexpected trailing input.");
  return ast;
}

/** Names the expression reads from a scope, e.g. ["a", "b"] for `a sin(bx)`. */
export function parametersOf(source: string): string[] {
  const found = new Set<string>();
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch {
    return [];
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "name") continue;
    const name = t.value.toLowerCase();
    if (name === "x" || name in CONSTANTS || name in FUNCTIONS) continue;
    if (!/^[a-z]$/.test(name)) continue;
    // A known function followed by "(" is a call, not a parameter.
    const next = tokens[i + 1];
    if (next && next.kind === "op" && next.value === "(") continue;
    found.add(name);
  }
  return [...found];
}

/**
 * True when `name` already means something in the expression language (the
 * variable, a constant, or a function). Such a name can never be a slider.
 */
export function isReservedName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "x" || lower in CONSTANTS || lower in FUNCTIONS;
}

/**
 * Converts one of our expressions into the LaTeX subset that Desmos' API
 * accepts, e.g. `a sin(bx)` becomes `a\\sin\\left(bx\\right)`. Returns null
 * when the expression is not valid, so callers can skip the Desmos render and
 * fall back to the local plotter.
 */
export function toDesmosLatex(source: string): string | null {
  try {
    return latexOf(parseExpressionTree(source));
  } catch {
    return null;
  }
}

/** How each constant is written in LaTeX. */
const CONSTANT_LATEX: Record<string, string> = {
  pi: "\\pi",
  tau: "\\tau",
  e: "e",
  phi: "\\varphi",
};

/** Operator precedence, used only to decide when to add parentheses. */
const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 4 };

function latexOf(node: Node): string {
  switch (node.kind) {
    case "number":
      return trimNumber(node.value);
    case "constant":
      return CONSTANT_LATEX[node.name] ?? node.name;
    case "variable":
      return "x";
    case "param":
      return node.name;
    case "unary":
      return node.op === "-" ? `-${latexOf(node.operand)}` : latexOf(node.operand);
    case "binary":
      return latexBinary(node);
    case "call":
      return latexCall(node);
  }
}

function latexBinary(node: Extract<Node, { kind: "binary" }>): string {
  const { op, left, right } = node;
  const leftText = parenthesise(left, op, "left");
  const rightText = parenthesise(right, op, "right");

  if (op === "/") return `\\frac{${latexOf(left)}}{${latexOf(right)}}`;
  if (op === "^") return `${leftText}^{${latexOf(right)}}`;
  if (op === "*") return `${leftText}\\cdot ${rightText}`;
  return `${leftText} ${op} ${rightText}`;
}

function latexCall(node: Extract<Node, { kind: "call" }>): string {
  const args = node.args.map(latexOf);
  const name = node.name;

  if (name === "sqrt") return `\\sqrt{${args[0]}}`;
  if (name === "cbrt") return `\\sqrt[3]{${args[0]}}`;
  if (name === "abs") return `\\left|${args[0]}\\right|`;
  if (name === "exp") return `e^{${args[0]}}`;
  if (name === "ln") return `\\ln\\left(${args.join(", ")}\\right)`;
  if (name === "log" || name === "log10") return `\\log_{10}\\left(${args.join(", ")}\\right)`;
  if (name === "log2") return `\\log_{2}\\left(${args.join(", ")}\\right)`;
  if (name === "pow") return `\\left(${args[0]}\\right)^{${args[1]}}`;
  if (name === "mod") return `\\operatorname{mod}\\left(${args.join(", ")}\\right)`;
  if (name === "floor") return `\\operatorname{floor}\\left(${args.join(", ")}\\right)`;
  if (name === "ceil") return `\\operatorname{ceil}\\left(${args.join(", ")}\\right)`;
  if (name === "round") return `\\operatorname{round}\\left(${args.join(", ")}\\right)`;
  if (name === "sign") return `\\operatorname{sign}\\left(${args.join(", ")}\\right)`;
  if (name === "hypot") return `\\sqrt{${args.map((a) => `\\left(${a}\\right)^2`).join("+")}}`;

  const known = ["sin", "cos", "tan", "csc", "sec", "cot", "sinh", "cosh", "tanh", "min", "max"];
  if (known.includes(name)) {
    const command = name.startsWith("a") ? `\\a${name.slice(1)}` : `\\${name}`;
    return `${command}\\left(${args.join(", ")}\\right)`;
  }
  return `\\operatorname{${name}}\\left(${args.join(", ")}\\right)`;
}

/**
 * Wraps a child in parentheses when the parent operator binds more tightly.
 * `(x+1)^2` needs them; `2x + 1` does not.
 */
function parenthesise(child: Node, parentOp: string, side: "left" | "right"): string {
  const text = latexOf(child);
  if (
    child.kind === "number" ||
    child.kind === "constant" ||
    child.kind === "variable" ||
    child.kind === "param"
  ) {
    return text;
  }
  if (child.kind === "call") return text;

  if (child.kind === "unary") return text;

  const childPrec = PRECEDENCE[child.op] ?? 0;
  const parentPrec = PRECEDENCE[parentOp] ?? 0;

  // Right operands of - and / need parens at equal precedence: a-(b+c), a/(b*c).
  const needsParens =
    childPrec < parentPrec ||
    (childPrec === parentPrec && side === "right" && (parentOp === "-" || parentOp === "/")) ||
    (parentOp === "^" && side === "left" && child.kind === "binary");

  return needsParens ? `\\left(${text}\\right)` : text;
}

function trimNumber(value: number): string {
  return String(Math.round(value * 1e10) / 1e10);
}

/**
 * Evaluates an expression that must not depend on x, e.g. a range endpoint
 * like `-2pi` or `tau`. Returns null when it is invalid or x-dependent.
 */
export function evalConstant(source: string): number | null {
  try {
    // Parameters have no value in a constant context, so treat them as zero.
    const value = compileExpression(source)(0, {});
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function evaluate(node: Node, x: number, scope?: Record<string, number>): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "constant":
      return CONSTANTS[node.name];
    case "variable":
      return x;
    case "param":
      // A missing parameter is treated as 0 so a graph still renders while the
      // student is mid-edit, rather than throwing on every keystroke.
      return scope?.[node.name] ?? 0;
    case "unary": {
      const v = evaluate(node.operand, x, scope);
      return node.op === "-" ? -v : v;
    }
    case "binary":
      return applyBinary(node.op, evaluate(node.left, x, scope), evaluate(node.right, x, scope));
    case "call":
      return FUNCTIONS[node.name](...node.args.map((arg) => evaluate(arg, x, scope)));
  }
}

function applyBinary(op: "+" | "-" | "*" | "/" | "^", a: number, b: number): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "^":
      return Math.pow(a, b);
  }
}

function tokenize(source: string): Token[] {
  const normalised = source.replace(
    /[\u2212\u00d7\u00f7\u03c0\u221a]/g,
    (ch) => ` ${REPLACEMENTS[ch]} `,
  );
  const tokens: Token[] = [];
  let i = 0;

  while (i < normalised.length) {
    const ch = normalised[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(normalised[i + 1] ?? ""))) {
      const start = i;
      while (i < normalised.length && (isDigit(normalised[i]) || normalised[i] === ".")) i++;
      if (normalised[i] === "e" || normalised[i] === "E") {
        const save = i;
        i++;
        if (normalised[i] === "+" || normalised[i] === "-") i++;
        if (isDigit(normalised[i] ?? "")) {
          while (i < normalised.length && isDigit(normalised[i])) i++;
        } else {
          i = save;
        }
      }
      const raw = normalised.slice(start, i);
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ExpressionError(`"${raw}" is not a number.`);
      tokens.push({ kind: "number", value });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < normalised.length && /[a-zA-Z_0-9]/.test(normalised[i])) i++;
      const raw = normalised.slice(start, i);
      const lower = raw.toLowerCase();
      const followedByCall = normalised[i] === "(";
      if (
        !(lower in FUNCTIONS) &&
        !(lower in CONSTANTS) &&
        !followedByCall &&
        /^[a-z]{2}$/.test(lower)
      ) {
        // Desmos-style adjacency: "bx" means b*x and "xy" means x*y. Runs of
        // three or more letters are left whole so a typo like "foo" still
        // fails loudly instead of becoming f*o*o, and a run followed by "(" is
        // kept intact so "qq(x)" errors rather than turning into q*q*(x).
        for (const letter of lower) tokens.push({ kind: "name", value: letter });
      } else {
        tokens.push({ kind: "name", value: raw });
      }
      continue;
    }

    if (ch === "*" && normalised[i + 1] === "*") {
      tokens.push({ kind: "op", value: "^" });
      i += 2;
      continue;
    }

    if ("+-*/^(),".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }

    throw new ExpressionError(`Unexpected character "${ch}".`);
  }

  return tokens;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

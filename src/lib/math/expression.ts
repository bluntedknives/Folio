/**
 * Compiles a maths expression into a fast `(x) => number` closure.
 *
 * There is deliberately no `eval` or `new Function` here. The source is
 * tokenised, parsed into an AST, and only the fixed tables below are
 * reachable from the result. Anything else throws, so a graph block can
 * never execute code.
 */

export class ExpressionError extends Error {}

export type Compiled = (x: number) => number;

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string };

type Node =
  | { kind: "number"; value: number }
  | { kind: "variable" }
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
      if (name in CONSTANTS) return { kind: "number", value: CONSTANTS[name] };
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
  return (x: number) => evaluate(ast, x);
}

/**
 * Evaluates an expression that must not depend on x, e.g. a range endpoint
 * like `-2pi` or `tau`. Returns null when it is invalid or x-dependent.
 */
export function evalConstant(source: string): number | null {
  try {
    const value = compileExpression(source)(0);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function evaluate(node: Node, x: number): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "variable":
      return x;
    case "unary": {
      const v = evaluate(node.operand, x);
      return node.op === "-" ? -v : v;
    }
    case "binary":
      return applyBinary(node.op, evaluate(node.left, x), evaluate(node.right, x));
    case "call":
      return FUNCTIONS[node.name](...node.args.map((arg) => evaluate(arg, x)));
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
      tokens.push({ kind: "name", value: normalised.slice(start, i) });
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

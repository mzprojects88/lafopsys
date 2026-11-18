# vendor

## picomatch-4.0.8-laf.1.tgz

Our own build of the `picomatch` package: the official 4.0.7 from npm with one change in
`lib/parse.js`. It is the only thing in this folder.

### Why it is here

Advisory GHSA-fc5q-39xc-vjpf (CVE-2026-112366, "ReDoS through single-branch repeated extglobs")
covers every published picomatch release (`<= 4.0.7`). On 18 Nov 2026 no repaired release
existed and the fixes proposed in the picomatch repository had not been merged, so an upgrade
could not bring `npm audit` to 0.

The app does not use picomatch. It comes in through developer tools only (typescript-eslint,
and vitest and vite where they are installed). `package.json` lists the file as a developer
dependency and points every other request for picomatch at that entry:

    "devDependencies": { "picomatch": "file:vendor/picomatch-4.0.8-laf.1.tgz" }
    "overrides":       { "picomatch": "$picomatch" }

so every tool gets this build, and `package-lock.json` pins the file by its checksum. The
direct entry is needed: npm (10 and 11) resolves a file path written straight into `overrides`
against the folder of the package that asks for picomatch, and fails to find it.

### What the change does

picomatch turns a glob into a regular expression. A repeated extglob, `+(...)` or `*(...)`,
with a branch that can match strings of different lengths (`+(*a)`, `+(a+)`, `+(a?(a))`) became
a repetition inside a repetition. A hostile string of 32 characters stalled the match for
seconds, and every further character doubled the time. 4.0.7 only looked for this when the
extglob had several branches.

This build refuses such an extglob the way 4.0.7 already refuses its other risky forms: it is
matched as plain text. An extglob `+(...)` or `*(...)` is refused when

- a branch that is not made of plain characters contains `*`, `+`, `(`, `{` or a backslash,
- it contains a double quote, or
- the `unescape` option is on and it contains a backslash.

Everything else compiles exactly as in 4.0.7. `maxExtglobRecursion: false` still switches the
safeguard off, and a nested repeat allowed with `maxExtglobRecursion: 1` still works.

### What it does not do

It does not make picomatch safe for patterns from outside. As in 4.0.7, alternatives that
overlap (`+(ab|ab)`, `+(a|ab|b)`) and plain regex groups written into a glob (`(a+)+`) still
backtrack. Here picomatch only ever receives the patterns in our own configuration files.

### How to check it

    node node_modules/picomatch/check.js

prints `ok: ...`. It first checks that each risky pattern compiles to plain text, so it cannot hang.

### How it was built

    npm pack picomatch@4.0.7
        sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==
    unpack; apply the change below to lib/parse.js; add check.js;
    in package.json: version 4.0.8-laf.1, a note in the description, "check.js" in "files"
    npm pack
        sha512-h1bCL2K0JWmcJ/wO16C575o8ZUG8tGH/rgUtLkhV4YlLOORo0Q+hiqU0lJMstpYgjfkDx7h4dcslYVP0P28EMw==

`npm pack` gives the same file every time, so the build can be repeated and compared.

### The change in lib/parse.js

```diff
@@ -284,6 +284,15 @@
   return depth;
 };
 
+// LAF patch for GHSA-fc5q-39xc-vjpf (not in the official 4.0.7).
+// A branch with one of these characters may match strings of different lengths:
+// a wildcard star, a "+" quantifier, a nested group, a brace set. The backslash
+// is on the list because the character after a run of backslashes is not always
+// read as a glob character (a "?" after four of them comes out as a regex
+// quantifier). No attempt is made to tell an escaped or bracketed character
+// from a live one: the test errs on the side of "risky".
+const VARIABLE_WIDTH = /[*+({\\]/;
+
 const analyzeRepeatedExtglob = (body, options) => {
   if (options.maxExtglobRecursion === false) {
     return { risky: false };
@@ -294,6 +303,15 @@
       ? options.maxExtglobRecursion
       : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
 
+  // LAF patch for GHSA-fc5q-39xc-vjpf (not in the official 4.0.7): a double
+  // quote changes how the characters around it are read (a "?" after a quoted
+  // string comes out as a regex quantifier), and with `unescape` a backslash
+  // hands the next character to the regex as it is. Neither can be judged branch
+  // by branch, so such an extglob is matched as plain text.
+  if (body.includes('"') || (options.unescape === true && body.includes('\\'))) {
+    return { risky: true };
+  }
+
   const branches = splitTopLevel(body).map(branch => branch.trim());
 
   if (branches.length > 1) {
@@ -332,7 +350,20 @@
 
     combinable = false;
 
-    if (repeatedExtglobRecursion(branch) > max) {
+    const depth = repeatedExtglobRecursion(branch);
+
+    if (depth > max) {
+      return { risky: true };
+    }
+
+    // LAF patch for GHSA-fc5q-39xc-vjpf (not in the official 4.0.7): repeating a
+    // branch of variable width is ambiguous, and that is what backtracks without
+    // end. 4.0.7 compiled `+(*)`, `+(*a)` and `+(a+)` as they stand. They now take
+    // the path of the other risky forms: the extglob is matched as plain text.
+    // A branch of plain characters is left alone, so is a nested repeat that
+    // `maxExtglobRecursion` allows, and `maxExtglobRecursion: false` still
+    // switches the whole safeguard off.
+    if (literal === undefined && depth === 0 && VARIABLE_WIDTH.test(branch)) {
       return { risky: true };
     }
   }
```

### When to remove it

When a repaired picomatch is published: delete the two `picomatch` lines from `package.json`
(in `devDependencies` and in `overrides`), delete
this folder, run `npm install`, then `npm audit`. If the advisory's range is changed to "below
the repaired version", `npm audit` will report this build again, which is the reminder.

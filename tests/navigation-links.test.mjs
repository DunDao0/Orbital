import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(location) : entry.name.endsWith(".tsx") ? [location] : [];
  }));
  return groups.flat();
}

test("internal links use the native fallback instead of broken beta RSC navigation", async () => {
  const files = await sourceFiles(fileURLToPath(new URL("../app", import.meta.url)));
  let checkedLinks = 0;
  for (const file of files) {
    const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = source.statements.filter((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier));
    assert.ok(!imports.some((node) => node.moduleSpecifier.text === "next/link"), `${file}: next/link production navigation remains broken in the pinned vinext beta`);
    const linkNames = new Set(imports.filter((node) => node.moduleSpecifier.text === "@/app/components/AppLink").map((node) => node.importClause?.name?.text).filter(Boolean));
    if (!linkNames.size) continue;
    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && linkNames.has(node.tagName.getText(source))) {
        const attributes = node.attributes.properties;
        assert.ok(attributes.some((item) => ts.isJsxAttribute(item) && item.name.getText(source) === "href"), `${file}: native navigation must preserve its href`);
        assert.ok(!attributes.some((item) => ts.isJsxAttribute(item) && item.name.getText(source) === "prefetch"), `${file}: framework prefetch props do not belong on native anchors`);
        checkedLinks++;
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.ok(checkedLinks >= 9, "the sidebar and existing route links must remain present");
});

test("native AppLink renders href and accessibility props without intercepting clicks", async () => {
  const source = await readFile(new URL("../app/components/AppLink.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const componentModule = { exports: {} };
  new Function("require", "module", "exports", compiled.outputText)(createRequire(import.meta.url), componentModule, componentModule.exports);
  const AppLink = componentModule.exports.default;
  const href = "/atlas/earth#scene=shared-state";
  const element = AppLink({ href, children: "Terra", "aria-label": "Abrir Terra", target: "_blank", rel: "noreferrer" });
  assert.equal(element.type, "a");
  assert.equal(element.props.href, href);
  assert.equal(element.props.onClick, undefined);
  assert.equal(element.props.onKeyDown, undefined);
  const html = renderToStaticMarkup(createElement(AppLink, { href, "aria-current": "page" }, "Terra"));
  assert.equal(html, '<a href="/atlas/earth#scene=shared-state" aria-current="page">Terra</a>');
  assert.equal(element.props.target, "_blank");
  assert.equal(element.props.rel, "noreferrer");
});

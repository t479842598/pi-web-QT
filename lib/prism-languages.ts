/**
 * Shared PrismLight instance for syntax highlighting.
 *
 * The full `react-syntax-highlighter` build bundles refractor with ~180
 * languages and every theme style; importing it anywhere pulls the whole
 * build into that chunk. This module registers only the languages actually
 * seen in agent conversations and file previews, so the heavy default build
 * is excluded entirely. Unregistered fence languages fall back to plain text
 * rendering inside the components (the library does this automatically).
 */
import PrismLight from "react-syntax-highlighter/dist/esm/prism-light";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import c from "react-syntax-highlighter/dist/esm/languages/prism/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import dart from "react-syntax-highlighter/dist/esm/languages/prism/dart";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import json5 from "react-syntax-highlighter/dist/esm/languages/prism/json5";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import kotlin from "react-syntax-highlighter/dist/esm/languages/prism/kotlin";
import lua from "react-syntax-highlighter/dist/esm/languages/prism/lua";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import php from "react-syntax-highlighter/dist/esm/languages/prism/php";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import ruby from "react-syntax-highlighter/dist/esm/languages/prism/ruby";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import scala from "react-syntax-highlighter/dist/esm/languages/prism/scala";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import swift from "react-syntax-highlighter/dist/esm/languages/prism/swift";
import toml from "react-syntax-highlighter/dist/esm/languages/prism/toml";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

// registerLanguage ignores the first argument (the module registers under its
// own displayName); aliases are added explicitly via alias().
PrismLight.registerLanguage("bash", bash);
PrismLight.alias("bash", ["shell", "sh", "zsh"]);
PrismLight.registerLanguage("c", c);
PrismLight.alias("c", ["h"]);
PrismLight.registerLanguage("cpp", cpp);
PrismLight.alias("cpp", ["cc", "cxx", "c++"]);
PrismLight.registerLanguage("csharp", csharp);
PrismLight.alias("csharp", ["cs", "c#"]);
PrismLight.registerLanguage("css", css);
PrismLight.registerLanguage("dart", dart);
PrismLight.registerLanguage("diff", diff);
PrismLight.registerLanguage("docker", docker);
PrismLight.alias("docker", ["dockerfile"]);
PrismLight.registerLanguage("go", go);
PrismLight.alias("go", ["golang"]);
PrismLight.registerLanguage("graphql", graphql);
PrismLight.alias("graphql", ["gql"]);
PrismLight.registerLanguage("ini", ini);
PrismLight.alias("ini", ["cfg", "properties"]);
PrismLight.registerLanguage("java", java);
PrismLight.registerLanguage("javascript", javascript);
PrismLight.alias("javascript", ["js", "mjs", "cjs"]);
PrismLight.registerLanguage("json", json);
PrismLight.registerLanguage("json5", json5);
PrismLight.registerLanguage("jsx", jsx);
PrismLight.registerLanguage("kotlin", kotlin);
PrismLight.alias("kotlin", ["kt", "kts"]);
PrismLight.registerLanguage("lua", lua);
PrismLight.registerLanguage("markup", markup);
PrismLight.alias("markup", ["html", "xml", "svg", "mathml", "xhtml"]);
PrismLight.registerLanguage("markdown", markdown);
PrismLight.alias("markdown", ["md", "mdx"]);
PrismLight.registerLanguage("php", php);
PrismLight.registerLanguage("powershell", powershell);
PrismLight.alias("powershell", ["ps1", "pwsh"]);
PrismLight.registerLanguage("python", python);
PrismLight.alias("python", ["py", "python3"]);
PrismLight.registerLanguage("ruby", ruby);
PrismLight.alias("ruby", ["rb"]);
PrismLight.registerLanguage("rust", rust);
PrismLight.alias("rust", ["rs"]);
PrismLight.registerLanguage("scala", scala);
PrismLight.registerLanguage("sql", sql);
PrismLight.registerLanguage("swift", swift);
PrismLight.registerLanguage("toml", toml);
PrismLight.registerLanguage("tsx", tsx);
PrismLight.registerLanguage("typescript", typescript);
PrismLight.alias("typescript", ["ts"]);
PrismLight.registerLanguage("yaml", yaml);
PrismLight.alias("yaml", ["yml"]);

export { PrismLight };

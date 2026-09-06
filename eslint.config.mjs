import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // Reference trees and packaged/generated output are not source to lint.
  { ignores: ["ref-repos/**", "release/**", ".next/**", "desktop/target/**", "desktop/resources/backend/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // fork 不启用 React Compiler 产物，手工 memo 模式不应报错
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  // bin/*.js 是有意为之的 CommonJS 启动脚本
  {
    files: ["bin/**/*.js", "scripts/**/*.cjs", "scripts/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default eslintConfig;

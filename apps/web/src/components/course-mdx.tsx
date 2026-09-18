import { evaluate } from "@mdx-js/mdx";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkMath from "remark-math";
import * as runtime from "react/jsx-runtime";

export async function CourseMdx({ source }: { source: string }) {
  const mod = await evaluate(source, {
    ...runtime,
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeSlug, rehypeKatex],
  });
  const Content = mod.default;
  return <article className="lesson-prose"><Content /></article>;
}

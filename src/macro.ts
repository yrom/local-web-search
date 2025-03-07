export const getReadabilityScript = async () => {
  const result = await Bun.build({
    entrypoints: ["./node_modules/@mozilla/readability/index.js"],
    format: "cjs",
    minify: true,
  })
  return result.outputs[0].text()
}

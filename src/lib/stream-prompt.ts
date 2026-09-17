/**
 * Shared prompt templates for the streaming engines.
 *
 * Both engine arms (Xmax x2.0 and Decart Lucy) use this single appearance-only
 * template set. Video-to-video models paint what the prompt describes, so the
 * templates describe appearance only — no behavioral instructions and no
 * negations. Edit here and both engines change together.
 */
export const buildPrompt = (
  preset: string | null,
  mode: "realistic" | "stylized",
  realism: number,
  _hasReference: boolean = false,
  background: string = "",
) => {
  let base: string;
  if (mode === "realistic") {
    const realismWord =
      realism <= 3 ? "heavily stylized, " : realism <= 7 ? "subtly enhanced, " : "true to life, ";
    base = `${realismWord}photorealistic person, natural human skin texture, realistic lighting, high detail, calm neutral expression`;
  } else {
    base = preset
      ? `a person as a ${preset} character, ${preset} art style, high quality, detailed, consistent appearance`
      : "a stylized character portrait, high quality, detailed, consistent appearance";
  }
  const bg = background.trim();
  return bg ? `${base} Background: ${bg}.` : base;
};

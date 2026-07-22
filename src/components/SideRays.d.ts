declare module "@/components/SideRays" {
  const SideRays: React.FC<{
    speed?: number;
    rayColor1?: string;
    rayColor2?: string;
    intensity?: number;
    spread?: number;
    origin?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
    tilt?: number;
    saturation?: number;
    blend?: number;
    falloff?: number;
    opacity?: number;
    className?: string;
  }>;
  export default SideRays;
}

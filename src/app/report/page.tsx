import type { Metadata } from "next";
import { GalaReport } from "@/components/report/GalaReport";

export const metadata: Metadata = {
  title: "Gala Report | Going Twice",
  description: "Money flow, paddles and lots for the PTA chair, built with AG Studio.",
};

export default function ReportPage() {
  return <GalaReport />;
}

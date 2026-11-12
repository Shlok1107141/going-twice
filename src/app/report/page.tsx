import type { Metadata } from "next";
import { GalaReport } from "@/components/report/GalaReport";
import { RoomGate } from "@/components/RoomGate";

export const metadata: Metadata = {
  title: "Gala Report | Going Twice",
  description: "Money flow, paddles and lots for the organizer, built with AG Studio.",
};

export default function ReportPage() {
  return (
    <RoomGate>
      <GalaReport />
    </RoomGate>
  );
}

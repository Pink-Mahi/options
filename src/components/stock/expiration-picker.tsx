"use client";

import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { OptionExpiration } from "@/lib/types";

export function ExpirationPicker({
  expirations,
  value,
  onChange,
}: {
  expirations: OptionExpiration[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (expirations.length === 0) {
    return <p className="text-sm text-muted-foreground">No expirations available.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto">
        {expirations.map((e) => (
          <option key={e.expirationDate} value={e.expirationDate}>
            {e.expirationDate} · {e.daysToExpiration} DTE
            {e.isLEAP ? " · LEAP" : e.isMonthly ? " · Monthly" : e.isWeekly ? " · Weekly" : ""}
          </option>
        ))}
      </Select>
      <Badge variant="outline">{expirations.length} expirations</Badge>
    </div>
  );
}

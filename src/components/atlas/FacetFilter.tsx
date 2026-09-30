import { Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Facet } from "@/lib/atlas/bundle";
import { cn } from "@/lib/utils";

export function FacetFilter({
  label,
  facets,
  selected,
  onChange,
}: {
  label: string;
  facets: Facet[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-between gap-1.5 text-[12px]">
          {label}
          {selected.length > 0 ? (
            <span className="rounded-sm bg-secondary px-1 text-[10px] font-semibold">
              {selected.length}
            </span>
          ) : null}
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={`Filter ${label.toLowerCase()}…`} className="text-[13px]" />
          <CommandList>
            <CommandEmpty>No values in the imported bundle.</CommandEmpty>
            <CommandGroup>
              {facets.map((f) => (
                <CommandItem key={f.value} value={f.value} onSelect={() => toggle(f.value)}>
                  <Check
                    className={cn(
                      "size-3.5",
                      selected.includes(f.value) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1 truncate text-[12px]">{f.value}</span>
                  <span className="mono-cell">{f.count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 ? (
          <div className="border-t border-border p-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-[12px]"
              onClick={() => onChange([])}
            >
              Clear {label.toLowerCase()}
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

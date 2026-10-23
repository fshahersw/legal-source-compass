import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppShell } from "@/components/atlas/AppShell";
import { CompanyProfile } from "@/components/safety/products/CompanyProfile";
import { pageHead } from "@/lib/corpus/head";

type S = { name?: string | undefined };

export const Route = createFileRoute("/safety_/companies")({
  validateSearch: (s: Record<string, unknown>): S => ({
    name:
      typeof s["name"] === "string" && s["name"].trim().length >= 2 && s["name"].length <= 200
        ? s["name"].trim()
        : undefined,
  }),
  head: () =>
    pageHead(
      "Company safety facts",
      "CFPB complaints, OSHA inspections, Open Payments and NHTSA complaints recorded under one exact company name.",
    ),
  component: Page,
});

function Page() {
  const { name } = Route.useSearch();
  return (
    <AppShell
      title={name ? `Company safety facts: ${name}` : "Company safety facts"}
      description="Complaints, inspections, payments and reports recorded under one exact company name, source by source."
      breadcrumbs={[
        { label: "Home", to: "/" },
        { label: "Product safety", to: "/safety" },
        { label: "Products & devices", to: "/safety/products" },
        { label: name ?? "Company" },
      ]}
    >
      {name ? <CompanyProfile name={name} /> : <NameForm />}
    </AppShell>
  );
}

function NameForm() {
  const navigate = Route.useNavigate();
  const [draft, setDraft] = useState("");
  const name = draft.trim();
  return (
    <div className="max-w-xl space-y-2">
      <p className="text-sm leading-6 text-muted-foreground">
        Enter a company name exactly as a source publishes it (for example a CFPB company or a
        device maker in MAUDE). Nothing is matched by a similar name. Makers on each{" "}
        <Link to="/safety/products" className="text-primary hover:underline">
          product page
        </Link>{" "}
        link here directly.
      </p>
      <form
        role="search"
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.length >= 2) void navigate({ search: { name } });
        }}
      >
        <label htmlFor="safety-company-name" className="sr-only">
          Exact company name
        </label>
        <Input
          id="safety-company-name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Exact company name"
          className="h-8 text-sm"
          maxLength={200}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-8"
          disabled={name.length < 2}
        >
          <Search className="size-3.5" aria-hidden />
          Open
        </Button>
      </form>
    </div>
  );
}

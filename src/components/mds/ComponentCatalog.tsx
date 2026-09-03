"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Status, requestStatusPresentation } from "@/components/ui/status";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function ComponentCatalog() {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [failConfirmation, setFailConfirmation] = useState(false);
  return <>
    <Header />
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-8">
      <PageHeader eyebrow="Mercurius Design System · Beta" title="Component foundation" description="Shared controls, feedback, and navigation. All examples use synthetic data and perform no marketplace operations." actions={<ThemeToggle showLabel />} />
      <section aria-labelledby="actions-heading" className="space-y-4">
        <h2 id="actions-heading" className="text-xl font-semibold">Actions and density</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="commitment">Request service</Button><Button>Neutral action</Button>
          <Button variant="outline">Outline action</Button><Button variant="secondary">Secondary action</Button>
          <Button variant="ghost">Ghost action</Button><Button variant="destructive">Destructive action</Button>
          <Button disabled>Disabled action</Button><Button loading>Saving…</Button>
          <Button size="compact">Compact action</Button>
        </div>
      </section>
      <section aria-labelledby="fields-heading" className="space-y-4">
        <h2 id="fields-heading" className="text-xl font-semibold">Form fields</h2>
        <form noValidate className="grid gap-6 sm:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("serviceName");
          setError(value ? "" : "Enter a service name.");
          setSaved(Boolean(value));
          if (!value) event.currentTarget.querySelector<HTMLInputElement>("#catalog-name")?.focus();
        }}>
          <FormField id="catalog-name" label="Service name" help="A short name for your example." error={error} required>{(control) => <Input {...control} name="serviceName" />}</FormField>
          <FormField label="Frequency" help="Choose a frequency for this example.">{(control) => <Select {...control} defaultValue=""><option value="" disabled>Choose frequency</option><option value="once">One time</option><option value="monthly">Monthly</option></Select>}</FormField>
          <FormField label="Notes" help="Up to 200 characters.">{(control) => <Textarea {...control} maxLength={200} />}</FormField>
          <div><Checkbox label="Include example details" /><Switch label="Enable example reminders" /><Checkbox label="Disabled checkbox" disabled /></div>
          <FormField label="Read-only reference">{(control) => <Input {...control} value="MDS-001" readOnly />}</FormField>
          <FormField label="Compact filter">{(control) => <Select {...control} density="compact"><option>All examples</option><option>Controls</option></Select>}</FormField>
          <div><Button type="submit" variant="commitment">Validate example</Button><p role="status" className="mt-2 text-sm">{saved ? "Example validated. No data was sent." : ""}</p></div>
        </form>
      </section>
      <section aria-labelledby="status-heading" className="space-y-4">
        <h2 id="status-heading" className="text-xl font-semibold">Request status vocabulary</h2>
        <p className="text-sm text-muted-foreground">Presentation only. Backend state reconciliation belongs to Phase 4.</p>
        <div className="flex flex-wrap gap-3">{(Object.keys(requestStatusPresentation) as Array<keyof typeof requestStatusPresentation>).map(state => <Status key={state} state={state} />)}</div>
      </section>
      <section aria-labelledby="overlays-heading" className="space-y-4">
        <h2 id="overlays-heading" className="text-xl font-semibold">Keyboard and focus</h2>
        <div className="flex flex-wrap gap-3">
          <Sheet><SheetTrigger render={<Button variant="outline" />}>Open example sheet</SheetTrigger><SheetContent className="p-6"><SheetTitle className="pr-12">Example navigation</SheetTitle><SheetDescription>Use Tab to move through the links. Escape closes this sheet.</SheetDescription><a href="#fields-heading">Form examples</a><SheetClose render={<Button variant="outline" />}>Done with sheet</SheetClose></SheetContent></Sheet>
          <Dialog><DialogTrigger render={<Button variant="outline" />}>Open example dialog</DialogTrigger><DialogContent><DialogTitle className="pr-12">Example details</DialogTitle><DialogDescription>Review this synthetic example, then close to return to the trigger.</DialogDescription><DialogClose render={<Button variant="outline" />}>Done with dialog</DialogClose></DialogContent></Dialog>
        </div>
        <Checkbox label="Simulate confirmation failure" checked={failConfirmation} onChange={event => setFailConfirmation(event.target.checked)} />
        <ConfirmAction triggerLabel="Remove example" title="Remove this example?" entity="Synthetic example MDS-001" consequence="This removes only the catalog example. No customer record or payment is affected." confirmLabel="Remove example" requireReason onConfirm={async () => { await new Promise(resolve => setTimeout(resolve, 600)); if (failConfirmation) throw new Error("Synthetic failure"); }} />
        <Tabs defaultValue="overview"><TabsList aria-label="Example sections"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="details">Details</TabsTrigger></TabsList><TabsContent value="overview">Use arrow keys to focus a tab, then Enter or Space to select it.</TabsContent><TabsContent value="details">This panel contains the example details.</TabsContent></Tabs>
      </section>
      <section aria-label="Shared page states" className="grid gap-4 sm:grid-cols-2">
        <PageState kind="loading" title="Loading examples" description="Please wait while examples load." />
        <PageState kind="empty" title="No examples yet" description="Add an example to get started." />
        <PageState kind="error" title="Examples could not load" description="Your changes have not been sent. Try again." action={<Button variant="outline">Try again</Button>} />
        <PageState kind="permission" title="Access required" description="This example needs an authorized account." />
      </section>
    </main>
  </>;
}

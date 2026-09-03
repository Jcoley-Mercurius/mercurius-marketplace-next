import { Checkbox, type CheckboxProps } from "@/components/ui/checkbox";

/** A native checkbox with switch semantics; label is always visible. */
export function Switch(props: Omit<CheckboxProps, "role">) {
  return <Checkbox {...props} role="switch" />;
}

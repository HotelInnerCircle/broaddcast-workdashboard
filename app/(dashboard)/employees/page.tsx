import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/context";
import { EmployeesView } from "@/components/employees/employees-view";
import { TableSkeleton } from "@/components/ui/skeleton";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  await requirePagePermission("employees", "view");
  return <Suspense fallback={<TableSkeleton />}><EmployeesView /></Suspense>;
}

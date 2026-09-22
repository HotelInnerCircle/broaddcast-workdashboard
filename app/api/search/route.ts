import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requireCompanySession } from "@/lib/auth/context";
import { searchQuerySchema } from "@/lib/validation/chat";
import { globalSearch } from "@/services/searchService";

/** Ctrl+K global search (spec 12.22): grouped, scope-filtered results. */
export const GET = route(async (req) => ok(await globalSearch(await requireCompanySession(), parseQuery(req, searchQuerySchema).q)));

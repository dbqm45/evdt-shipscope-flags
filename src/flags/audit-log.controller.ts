import { Controller, Get, Query } from "@nestjs/common";
import { parseAuditQuery } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";

@Controller("audit-log")
export class AuditLogController {
  constructor(private readonly flags: FlagsService) {}

  /** ?limit=50&before=<nextCursor>&flagKey=&serviceKey=&action=&actor=&q= → { entries, nextCursor? }, newest first. */
  @Get()
  list(@Query() query: Record<string, unknown>) {
    return this.flags.listAuditLog(parseAuditQuery(query));
  }
}

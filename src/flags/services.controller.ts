import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { parseActor, parseRegisterService, parseRotateCredential } from "./flags.input.js";
import { FlagsService } from "./flags.service.js";

/** Management API for the services that read flags, and their credentials. */
@Controller("services")
export class ServicesController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  list() {
    return this.flags.listServices();
  }

  /** 201 with the service and its credential; the credential is shown only in this response. */
  @Post()
  register(@Body() body: unknown) {
    return this.flags.registerService(parseRegisterService(body), parseActor(body));
  }

  /** New credential (shown once); the old one keeps working for 24 h unless the body says "revokePrevious": true. */
  @Post(":id/credential")
  @HttpCode(200)
  rotateCredential(@Param("id") id: string, @Body() body: unknown) {
    return this.flags.rotateCredential(id, parseRotateCredential(body).revokePrevious, parseActor(body));
  }
}

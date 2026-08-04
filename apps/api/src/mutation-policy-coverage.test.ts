import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, MODULE_METADATA } from "@nestjs/common/constants";
import { AppModule } from "./app.module";
import { AUTHORIZATION_POLICY } from "./permission.guard";
import { PUBLIC_ROUTE } from "./public-route.decorator";

describe("mutation authorization policy coverage", () => {
  it("requires every non-public mutation to declare a permission or explicit policy", () => {
    const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) ?? []) as Array<
      new (...args: never[]) => unknown
    >;
    const uncovered: string[] = [];
    const mutationMethods = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);

    for (const controller of controllers) {
      const prototype = controller.prototype as Record<string, unknown>;
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === "constructor") continue;
        const handler = prototype[methodName];
        if (typeof handler !== "function") continue;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (requestMethod === undefined || !mutationMethods.has(requestMethod)) continue;
        const isPublic =
          Reflect.getMetadata(PUBLIC_ROUTE, handler) === true || Reflect.getMetadata(PUBLIC_ROUTE, controller) === true;
        const hasPolicy =
          Reflect.getMetadata(AUTHORIZATION_POLICY, handler) === true ||
          Reflect.getMetadata(AUTHORIZATION_POLICY, controller) === true;
        if (!isPublic && !hasPolicy) uncovered.push(`${controller.name}.${methodName}`);
      }
    }

    assert.deepEqual(uncovered, []);
  });

  it("requires every non-public HTTP route to declare an authorization policy", () => {
    const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) ?? []) as Array<
      new (...args: never[]) => unknown
    >;
    const uncovered: string[] = [];

    for (const controller of controllers) {
      const prototype = controller.prototype as Record<string, unknown>;
      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === "constructor") continue;
        const handler = prototype[methodName];
        if (typeof handler !== "function") continue;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (requestMethod === undefined) continue;
        const isPublic =
          Reflect.getMetadata(PUBLIC_ROUTE, handler) === true || Reflect.getMetadata(PUBLIC_ROUTE, controller) === true;
        const hasPolicy =
          Reflect.getMetadata(AUTHORIZATION_POLICY, handler) === true ||
          Reflect.getMetadata(AUTHORIZATION_POLICY, controller) === true;
        if (!isPublic && !hasPolicy) uncovered.push(`${controller.name}.${methodName}`);
      }
    }

    assert.deepEqual(uncovered, []);
  });
});

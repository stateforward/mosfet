import * as hsm from "../hsm.ts";

/** One part in the bridge's parts bin. `available: false` parts are shown but cannot be fitted here. */
export type Part = {
  readonly id: string;
  readonly label: string;
  readonly describes: string;
  readonly needs: readonly string[];
  readonly available: boolean;
  readonly note: string | null;
};

export type Catalog = { readonly devices: readonly Part[]; readonly abilities: readonly Part[]; readonly cognition: string };

export type BuildSpec = { readonly name: string; readonly devices: readonly string[]; readonly abilities: readonly string[] };
export type BuildReply = { readonly bot: string | null; readonly label: string | null; readonly problem: string | null };

/** How the builder reaches the bridge. Injected so tests can stand in for HTTP. Methods reject when unreachable. */
export type BuilderTransport = {
  catalog(): Promise<Catalog>;
  build(spec: BuildSpec): Promise<BuildReply>;
  /** Best effort: also used while the page is closing. */
  stop(bot: string): void;
};

function partFrom(value: unknown): Part | null {
  if (!hsm.isRecord(value) || typeof value["id"] !== "string") return null;
  return {
    id: value["id"],
    label: typeof value["label"] === "string" ? value["label"] : value["id"],
    describes: typeof value["describes"] === "string" ? value["describes"] : "",
    needs: Array.isArray(value["needs"]) ? value["needs"].map(String) : [],
    available: value["available"] !== false,
    note: typeof value["note"] === "string" ? value["note"] : null,
  };
}

const parts = (value: unknown): Part[] =>
  Array.isArray(value) ? value.map(partFrom).filter((part): part is Part => part !== null) : [];

/** The workshop bridge's builder, through the dev server's `/api` proxy. */
export const httpBuilderTransport: BuilderTransport = {
  async catalog() {
    const response = await fetch("/api/builder/catalog");
    if (!(response.headers.get("Content-Type") ?? "").includes("json")) throw new Error(`the workshop answered ${response.status}`);
    const body: unknown = await response.json();
    if (!hsm.isRecord(body)) throw new Error("the workshop sent no catalog");
    const cognition = hsm.isRecord(body["cognition"]) && typeof body["cognition"]["describes"] === "string" ? body["cognition"]["describes"] : "";
    return { devices: parts(body["devices"]), abilities: parts(body["abilities"]), cognition };
  },
  async build(spec) {
    const response = await fetch("/api/builder/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec),
    });
    if (!(response.headers.get("Content-Type") ?? "").includes("json")) throw new Error(`the workshop answered ${response.status}`);
    const body: unknown = await response.json();
    const record = hsm.isRecord(body) ? body : {};
    const bot = typeof record["bot"] === "string" ? record["bot"] : null;
    const label = typeof record["label"] === "string" ? record["label"] : null;
    return { bot, label: bot === null ? null : label, problem: bot === null ? (label ?? "The build failed.") : null };
  },
  stop(bot) {
    void fetch("/api/builder/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bot }),
      keepalive: true,
    }).catch(() => undefined);
  },
};

const recheckDelay = (): number => Builder.recheckMs;

/** Names a newcomer can boot without thinking about it. */
export const BOT_NAMES = ["pip", "moss", "biscuit", "juniper", "noodle", "tuck"] as const;

/**
 * Assembling a real bot from the bridge's parts bin.
 *
 * `loading` fetches the catalog (`offline` retries on a modeled timer). `picking` takes part toggles and a name;
 * `booting` is the build request in flight; `booted` holds a live bot on the bridge until `rebuild` stops it. Leaving
 * `booted` for any reason — including stopping the machine — stops that bot. "Is there a bot" is the state path.
 */
export class Builder extends hsm.Instance {
  static readonly toggleEvent = { name: "builder.toggle", kind: hsm.Kinds.Event } as const;
  static readonly nameEvent = { name: "builder.name", kind: hsm.Kinds.Event } as const;
  static readonly bootEvent = { name: "builder.boot", kind: hsm.Kinds.Event } as const;
  static readonly rebuildEvent = { name: "builder.rebuild", kind: hsm.Kinds.Event } as const;
  static readonly loadedEvent = { name: "builder.loaded", kind: hsm.Kinds.Event } as const;
  static readonly builtEvent = { name: "builder.built", kind: hsm.Kinds.Event } as const;
  static readonly changedEvent = { name: "builder.changed", kind: hsm.Kinds.Event } as const;

  static recheckMs = 4000;

  static readonly model = hsm.define(
    "Builder",
    hsm.initial(hsm.target("loading")),
    hsm.state(
      "loading",
      hsm.entry(Builder.loadCatalog),
      hsm.transition(hsm.on(Builder.loadedEvent.name), hsm.guard(Builder.hasCatalog), hsm.target("../picking"), hsm.effect(Builder.keepCatalog)),
      hsm.transition(hsm.on(Builder.loadedEvent.name), hsm.target("../offline")),
    ),
    hsm.state(
      "offline",
      hsm.entry(Builder.enterOffline),
      hsm.transition(hsm.after(recheckDelay), hsm.target("../loading")),
    ),
    hsm.state(
      "picking",
      hsm.entry(Builder.enterPicking),
      hsm.transition(hsm.on(Builder.toggleEvent.name), hsm.guard(Builder.fits), hsm.effect(Builder.toggle)),
      hsm.transition(hsm.on(Builder.nameEvent.name), hsm.effect(Builder.rename)),
      hsm.transition(hsm.on(Builder.bootEvent.name), hsm.target("../booting")),
    ),
    hsm.state(
      "booting",
      hsm.entry(Builder.boot),
      hsm.transition(hsm.on(Builder.builtEvent.name), hsm.guard(Builder.gotBot), hsm.target("../booted"), hsm.effect(Builder.keepBot)),
      hsm.transition(hsm.on(Builder.builtEvent.name), hsm.target("../picking"), hsm.effect(Builder.buildFailed)),
    ),
    hsm.state(
      "booted",
      hsm.entry(Builder.enterBooted),
      hsm.exit(Builder.stopBot),
      hsm.transition(hsm.on(Builder.rebuildEvent.name), hsm.target("../picking")),
    ),
  );

  transport: BuilderTransport = httpBuilderTransport;
  catalog: Catalog | null = null;
  devices = new Set<string>(["phone"]);
  abilities = new Set<string>();
  name: string = BOT_NAMES[0];
  /** The live bot on the bridge, while `booted`. */
  bot: string | null = null;
  /** What the bridge says the bot is made of, while `booted`. */
  label = "";
  problem: string | null = null;

  static hasCatalog(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && hsm.isRecord(event.data["catalog"]);
  }

  static gotBot(_ctx: hsm.Context, _instance: hsm.Instance, event: hsm.Event): boolean {
    return hsm.isRecord(event.data) && typeof event.data["bot"] === "string";
  }

  /** A part can be toggled when it exists here and can be fitted in this workshop. */
  static fits(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): boolean {
    if (!(instance instanceof Builder) || instance.catalog === null) return false;
    const id = hsm.isRecord(event.data) ? event.data["part"] : undefined;
    const part = [...instance.catalog.devices, ...instance.catalog.abilities].find((p) => p.id === id);
    return part !== undefined && part.available;
  }

  static loadCatalog(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Builder)) return;
    Builder.show(instance, false);
    instance.transport.catalog().then(
      (catalog) => Builder.tell(instance, Builder.loadedEvent, { catalog }),
      () => Builder.tell(instance, Builder.loadedEvent, { catalog: null }),
    );
  }

  static keepCatalog(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Builder) || !hsm.isRecord(event.data)) return;
    instance.catalog = event.data["catalog"] as Catalog;
    const known = new Set(instance.catalog.devices.filter((p) => p.available).map((p) => p.id));
    for (const id of instance.devices) if (!known.has(id)) instance.devices.delete(id);
    instance.problem = null;
  }

  static enterOffline(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Builder)) return;
    instance.problem = "The workshop bridge isn't answering.";
    Builder.show(instance, false);
  }

  static enterPicking(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Builder) Builder.show(instance, false);
  }

  /**
   * Toggle a part. Fitting an ability fits the devices it needs; removing a device removes the abilities that need
   * it, so the spec the bridge sees is always buildable.
   */
  static toggle(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Builder) || instance.catalog === null) return;
    const id = hsm.isRecord(event.data) ? String(event.data["part"]) : "";
    const ability = instance.catalog.abilities.find((p) => p.id === id);
    if (ability !== undefined) {
      if (instance.abilities.delete(id)) return Builder.show(instance, false);
      instance.abilities.add(id);
      for (const need of ability.needs) instance.devices.add(need);
      return Builder.show(instance, false);
    }
    if (instance.devices.delete(id)) {
      for (const other of instance.catalog.abilities) if (other.needs.includes(id)) instance.abilities.delete(other.id);
    } else {
      instance.devices.add(id);
    }
    Builder.show(instance, false);
  }

  static rename(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Builder)) return;
    const raw = hsm.isRecord(event.data) ? event.data["name"] : undefined;
    instance.name = typeof raw === "string" ? raw.trim().slice(0, 40) : instance.name;
    Builder.show(instance, false);
  }

  static boot(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Builder)) return;
    instance.problem = null;
    if (instance.name === "") instance.name = BOT_NAMES[0];
    Builder.show(instance, false);
    instance.transport
      .build({ name: instance.name, devices: [...instance.devices], abilities: [...instance.abilities] })
      .then(
        (reply) => Builder.tell(instance, Builder.builtEvent, reply),
        (error: unknown) => Builder.tell(instance, Builder.builtEvent, { bot: null, label: null, problem: `Couldn't reach the workshop: ${String(error)}` }),
      );
  }

  static keepBot(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Builder) || !hsm.isRecord(event.data)) return;
    instance.bot = String(event.data["bot"]);
    instance.label = typeof event.data["label"] === "string" ? event.data["label"] : instance.name;
  }

  static buildFailed(_ctx: hsm.Context, instance: hsm.Instance, event: hsm.Event): void {
    if (!(instance instanceof Builder)) return;
    const problem = hsm.isRecord(event.data) ? event.data["problem"] : undefined;
    instance.problem = typeof problem === "string" ? problem : "The build failed.";
  }

  static enterBooted(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (instance instanceof Builder) Builder.show(instance, true);
  }

  static stopBot(_ctx: hsm.Context, instance: hsm.Instance): void {
    if (!(instance instanceof Builder) || instance.bot === null) return;
    instance.transport.stop(instance.bot);
    instance.bot = null;
    instance.label = "";
  }

  private static tell(instance: Builder, event: { readonly name: string; readonly kind: hsm.Event["kind"] }, data: unknown): void {
    void Promise.resolve(hsm.dispatch(instance, hsm.typedEvent({ event, data }))).catch((error: unknown) => {
      if (hsm.hostDropFrom({ error, host: instance }) !== null) return;
      hsm.catchFailure(hsm.ownerTarget(instance))(error);
    });
  }

  /** Tell the owner something changed; `booted` is explicit because entry actions can still read the old state path. */
  private static show(instance: Builder, booted: boolean): void {
    void hsm.notifyOwner({
      instance,
      event: hsm.typedEvent({ event: Builder.changedEvent, data: { booted } }),
    }).catch(hsm.catchFailure(hsm.ownerTarget(instance)));
  }
}

/**
 * Start a Builder under `ctx`, optionally over a transport other than the HTTP bridge.
 *
 * Outputs: a started Builder in `/Builder/loading`. Ownership: caller must `hsm.stop` it, which stops a booted bot.
 */
export function startBuilder(args: { ctx: hsm.Context; transport?: BuilderTransport }): Builder {
  const builder = new Builder();
  if (args.transport) builder.transport = args.transport;
  return hsm.start({ ctx: args.ctx, instance: builder, model: Builder.model });
}

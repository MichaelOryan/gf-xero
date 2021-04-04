import * as fs from "fs";
export default class TenantCache {
  private cache: any = {};
  private cacheFilePath;

  constructor(cacheFilePath: string = './cache.json') {
    this.cacheFilePath = cacheFilePath;
    return this;
  }

  public load(): TenantCache {
    try {
      const cache = JSON.parse(
        fs.readFileSync(this.cacheFilePath, { encoding: "utf8", flag: "r" })
      );
      this.cache = cache;
    } catch (e) {
    } finally {
      return this;
    }
  }

  public get(tenantId, type):any {
    return (this.cache[tenantId] || {})[type] || {};
  }

  public update(tenantId, type, data): TenantCache {
    this.cache[tenantId] = this.cache[tenantId] || {};
    this.cache[tenantId][type] = data;
    return this;
  }

  public exists(tenantId, type):any {
    return this.cache[tenantId] && this.cache[tenantId][type] !== undefined;
  }

  public save(): TenantCache {
    try {
      fs.writeFileSync("./cache.json", JSON.stringify(this.cache), {
        encoding: "utf8",
      });
    } catch (e) {
    } finally {
      return this;
    }
  }

  public flush(): TenantCache{
      this.cache = {};
      this.save();
      return this;
  }
}

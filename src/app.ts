require("dotenv").config();
import * as bodyParser from "body-parser";
import * as crypto from 'crypto';
import express from "express";
import { Request, Response } from "express";
import { TokenSet } from 'openid-client';
// import * as fs from "fs";
import TenantCache from './helper/cache';
import Helper from './helper/helper';

import {
  XeroAccessToken,
  XeroClient,
  XeroIdToken,
} from "xero-node";
import jwtDecode from 'jwt-decode';

const session = require("express-session");
var FileStore = require('session-file-store')(session);
const path = require("path");

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirectUrl = process.env.REDIRECT_URI;
const scopes = [
  "offline_access",
  "openid",
  "profile",
  "email",
  "accounting.transactions.read",
  "accounting.reports.read",
  "accounting.contacts.read",
  "payroll.employees.read",
].join(' ');


let tenantCache = new TenantCache('./cache.json').load();

const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
  redirectUris: [redirectUrl],
  scopes: scopes.split(" "),
  // include a state param to protect against CSRF
  // for more information on how xero-node library leverages openid-client library check out the README
  // https://github.com/XeroAPI/xero-node
  state: "imaParam=look-at-me-go", //TODO: Use this for security
  httpTimeout: 2000
});

if (!client_id || !client_secret || !redirectUrl) {
  throw Error('Environment Variables not all set - please check your .env file in the project root or create one!')
}

const xeroHelper = new Helper(xero);

class App {
  public app: express.Application;
  public consentUrl: Promise<string>

  constructor() {
    this.app = express();
    this.config();
    this.routes();
    this.app.set("views", path.join(__dirname, "views"));
    this.app.set("view engine", "ejs");
    this.app.use(express.static(path.join(__dirname, "public")));

    this.consentUrl = xero.buildConsentUrl()
  }

  private config(): void {
    this.app.use(bodyParser.urlencoded({ extended: false }));
    this.app.use('/webhooks', bodyParser.raw({ type: 'application/json' }));
    this.app.use(bodyParser.json());
  }

  // helpers
  authenticationData(req, _res) {
    return {
      decodedIdToken: req.session.decodedIdToken,
      tokenSet: req.session.tokenSet,
      decodedAccessToken: req.session.decodedAccessToken,
      accessTokenExpires: this.timeSince(req.session.decodedAccessToken),
      allTenants: req.session.allTenants,
      activeTenant: req.session.activeTenant
    }
  }

  timeSince(token) {
    if (token) {
      const timestamp = token['exp']
      const myDate = new Date(timestamp * 1000)
      return myDate.toLocaleString()
    } else {
      return ''
    }
  }

  private routes(): void {
    const router = express.Router();

    router.get("/", async (req: Request, res: Response) => {
      try {
        if (req.session.tokenSet) {
          // This reset the session and required data on the xero client after ts recompile
          await xero.setTokenSet(req.session.tokenSet)
          await xero.updateTenants(false)
        }
      } catch(e) {

      }

      try {
        const authData = this.authenticationData(req, res);
        
        const tenantId = req.session.activeTenant.tenantId;

        res.render("home", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: authData,
          ... await loadSharedViewTables(authData, tenantId)
        });
      } catch (e) {
        res.status(res.statusCode);
        res.render("shared/error", {
          consentUrl: await xero.buildConsentUrl(),
          error: e
        });
      }
    });

    router.get("/callback", async (req: Request, res: Response) => {
      try {
        // calling apiCallback will setup all the client with
        // and return the orgData of each authorized tenant
        const tokenSet: TokenSet = await xero.apiCallback(req.url);

        await xero.updateTenants(false)

        // console.log('xero.config.state: ', xero.config.state)

        // this is where you can associate & save your
        // `tokenSet` to a user in your Database
        req.session.tokenSet = tokenSet
        if (tokenSet.id_token) {
          const decodedIdToken: XeroIdToken = jwtDecode(tokenSet.id_token)
          req.session.decodedIdToken = decodedIdToken
        }
        const decodedAccessToken: XeroAccessToken = jwtDecode(tokenSet.access_token)
        req.session.decodedAccessToken = decodedAccessToken
        req.session.tokenSet = tokenSet
        req.session.allTenants = xero.tenants
        req.session.activeTenant = xero.tenants[0]

        const authData = this.authenticationData(req, res);
        
        const tenantId = req.session.activeTenant.tenantId;



        res.render("callback", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: authData,
          ... await loadSharedViewTables(authData, tenantId)

          
          
        });
      } catch (e) {
        res.status(res.statusCode);
        res.render("shared/error", {
          authenticated: false,
          consentUrl: await xero.buildConsentUrl(),
          error: e
        });
      }
    });

    router.post("/change_organisation", async (req: Request, res: Response) => {
      try {
        const activeOrgId = req.body.active_org_id
        const picked = xero.tenants.filter((tenant) => tenant.tenantId == activeOrgId)[0]
        req.session.activeTenant = picked
        const tenantId = req.session.activeTenant.tenantId;
        const authData = this.authenticationData(req, res)

        res.render("home", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: this.authenticationData(req, res),
          ... await loadSharedViewTables(authData, tenantId)
        });
      } catch (e) {
        res.status(res.statusCode);
        res.render("shared/error", {
          authenticated: false,
          consentUrl: await xero.buildConsentUrl(),
          error: e
        });
      }
    });

    router.get("/refresh-token", async (req: Request, res: Response) => {
      try {
        const tokenSet = await xero.readTokenSet();
        console.log('tokenSet.expires_in: ', tokenSet.expires_in, ' seconds')
        console.log('tokenSet.expires_at: ', tokenSet.expires_at, ' milliseconds')
        console.log('Readable expiration: ', new Date(tokenSet.expires_at * 1000).toLocaleString())
        console.log('tokenSet.expired(): ', tokenSet.expired());

        if (tokenSet.expired()) {
          console.log('tokenSet is currently expired: ', tokenSet)
        } else {
          console.log('tokenSet is not expired: ', tokenSet)
        }

        // you can refresh the token using the fully initialized client levereging openid-client
        await xero.refreshToken()

        // or if you already generated a tokenSet and have a valid (< 60 days refresh token),
        // you can initialize an empty client and refresh by passing the client, secret, and refresh_token
        const newXeroClient = new XeroClient()
        const newTokenSet = await newXeroClient.refreshWithRefreshToken(client_id, client_secret, tokenSet.refresh_token)
        const decodedIdToken: XeroIdToken = jwtDecode(newTokenSet.id_token);
        const decodedAccessToken: XeroAccessToken = jwtDecode(newTokenSet.access_token)

        req.session.decodedIdToken = decodedIdToken
        req.session.decodedAccessToken = decodedAccessToken
        req.session.tokenSet = newTokenSet
        req.session.allTenants = xero.tenants
        req.session.activeTenant = xero.tenants[0]

        const authData = this.authenticationData(req, res);
        const tenantId = req.session.activeTenant.tenantId;

        res.render("home", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: this.authenticationData(req, res),
          ... await loadSharedViewTables(authData, tenantId)
        });
      } catch (e) {
        res.status(res.statusCode);
        res.render("shared/error", {
          authenticated: false,
          consentUrl: await xero.buildConsentUrl(),
          error: e
        });
      }
    });

    router.get("/disconnect", async (req: Request, res: Response) => {
      try {
        const updatedTokenSet: TokenSet = await xero.disconnect(req.session.activeTenant.id)
        await xero.updateTenants(false)

        if (xero.tenants.length > 0) {
          const decodedIdToken: XeroIdToken = jwtDecode(updatedTokenSet.id_token);
          const decodedAccessToken: XeroAccessToken = jwtDecode(updatedTokenSet.access_token)
          req.session.decodedIdToken = decodedIdToken
          req.session.decodedAccessToken = decodedAccessToken
          req.session.tokenSet = updatedTokenSet
          req.session.allTenants = xero.tenants
          req.session.activeTenant = xero.tenants[0]
        } else {
          req.session.decodedIdToken = undefined
          req.session.decodedAccessToken = undefined
          req.session.allTenants = undefined
          req.session.activeTenant = undefined
        }
        const authData = this.authenticationData(req, res)

        res.render("home", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: authData
        });
      } catch (e) {
        res.status(res.statusCode);
        res.render("shared/error", {
          authenticated: false,
          consentUrl: await xero.buildConsentUrl(),
          error: e
        });
      }
    });

    const fileStoreOptions = {}
    router.get("/revoke-token", async (req: Request, res: Response) => {
      try {
        await xero.revokeToken();
        req.session.decodedIdToken = undefined
        req.session.decodedAccessToken = undefined
        req.session.tokenSet = undefined
        req.session.allTenants = undefined
        req.session.activeTenant = undefined

        res.render("home", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: this.authenticationData(req, res)
        });
      } catch (e) {
        res.status(res.statusCode);
        res.render("shared/error", {
          authenticated: false,
          consentUrl: await xero.buildConsentUrl(),
          error: e
        });
      }
    })

    router.get("/employees", async (req: Request, res: Response) => {
      try {
        const tenantId = req.session.activeTenant.tenantId;
        if(!tenantCache.exists(tenantId, 'averageSalary')) {
          const invoiceTables = await xeroHelper.loadAverageSalary(tenantId);
          tenantCache.update(tenantId, 'averageSalary', invoiceTables);
          tenantCache.save();
        }

        const {employeesCount, averageSalary} = tenantCache.get(tenantId, 'averageSalary');

        res.render("employees", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: this.authenticationData(req, res),
          count: employeesCount,
          avergeSalary: averageSalary,
          currencyFormatter: number => new Intl.NumberFormat('en-AU', { maximumSignificantDigits: 2 , minimumSignificantDigits: 2, currencyDisplay: 'narrowSymbol', currency: 'AUD', style: 'currency'}).format(number),
        });
      } catch (e) {
        res.status(res.statusCode);
        res.render("shared/error", {
          authenticated: false,
          consentUrl: await xero.buildConsentUrl(),
          error: e
        });
      }

    });

    router.get("/invoices", async (req: Request, res: Response) => {
      try {
        const tenantId = req.session.activeTenant.tenantId;

        if(!tenantCache.exists(tenantId, 'invoiceTables')) {
          const invoiceTables = await xeroHelper.loadInvoiceTables(tenantId);
          tenantCache.update(tenantId, 'invoiceTables', invoiceTables);
          tenantCache.save();
        }

        const {customerTable, supplierTable} = tenantCache.get(tenantId, 'invoiceTables');

        res.render("invoices", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: this.authenticationData(req, res),
          customers: customerTable,
          suppliers: supplierTable,
          currencyFormatter: number => new Intl.NumberFormat('en-AU', { maximumSignificantDigits: 2 , minimumSignificantDigits: 2, currencyDisplay: 'narrowSymbol', currency: 'AUD', style: 'currency'}).format(number),
        });
      } catch (e) {
        res.status(res.statusCode);
        res.render("shared/error", {
          authenticated: false,
          consentUrl: await xero.buildConsentUrl(),
          error: e
        });
      }

    });

    this.app.use(session({
      secret: "something crazy",
      store: new FileStore(fileStoreOptions),
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false },
    }));

    this.app.use("/", router);
  }
}

async function loadSharedViewTables(authData, tenantId: string) {
  let tables = {
    supplierTable: [],
    customerTable: [],
    employeesCount: 0,
    averageSalary: 0,
   };

  if(isAuthenticated(authData)) {
    if(isAuthenticated(authData))
      tables = await loadTables(tenantId)
  }

  return {
    suppliers: tables.supplierTable,
    customers: tables.customerTable,
    count: tables.employeesCount,
    averageSalary: tables.averageSalary,
    currencyFormatter: number => new Intl.NumberFormat('en-AU', { maximumSignificantDigits: 2 , minimumSignificantDigits: 2, currencyDisplay: 'narrowSymbol', currency: 'AUD', style: 'currency'}).format(number),
  }

}

async function loadTables(tenantId: string) {

  if(!tenantCache.exists(tenantId, 'invoiceTables')) {
    const invoiceTables = await xeroHelper.loadInvoiceTables(tenantId);
    tenantCache.update(tenantId, 'invoiceTables', invoiceTables);
    tenantCache.save();
  }

  const {customerTable, supplierTable} = tenantCache.get(tenantId, 'invoiceTables');

  if(!tenantCache.exists(tenantId, 'averageSalary')) {
    const invoiceTables = await xeroHelper.loadAverageSalary(tenantId);
    tenantCache.update(tenantId, 'averageSalary', invoiceTables);
    tenantCache.save();
  }

  const {employeesCount, averageSalary} = tenantCache.get(tenantId, 'averageSalary');

  return {customerTable, supplierTable, employeesCount, averageSalary};
}

function isAuthenticated(authenticated) {
  return (authenticated.decodedIdToken && authenticated.decodedAccessToken && authenticated.activeTenant)
}

export default new App().app;

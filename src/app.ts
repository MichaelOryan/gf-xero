require("dotenv").config();
import * as bodyParser from "body-parser";
import * as crypto from 'crypto';
import express from "express";
import { Request, Response } from "express";
import { TokenSet } from 'openid-client';
import * as fs from "fs";

import {
  // Account,
  // Accounts,
  // AccountType,
  // Allocation,
  // Allocations,
  // BankTransaction,
  // BankTransactions,
  // BankTransfer,
  // BankTransfers,
  // BatchPayment,
  // BatchPayments,
  // Contact,
  // ContactGroup,
  // ContactGroups,
  // ContactPerson,
  // Contacts,
  // Currency,
  // CurrencyCode,
  // Employees,
  // HistoryRecords,
  Invoice,
  // Invoices,
  // Item,
  // Items,
  // LineAmountTypes,
  // LineItem,
  // LinkedTransaction,
  // LinkedTransactions,
  // ManualJournal,
  // ManualJournals,
  // Payment,
  // Payments,
  // PaymentServices,
  // Prepayment,
  // PurchaseOrder,
  // PurchaseOrders,
  // Quote,
  // Quotes,
  // Receipt,
  // Receipts,
  // TaxRate,
  // TaxRates,
  // TaxType,
  // TrackingCategories,
  // TrackingCategory,
  // TrackingOption,
  XeroAccessToken,
  XeroClient,
  XeroIdToken,
  // CreditNotes,
  // CreditNote,
  // Employee,
} from "xero-node";
// import Helper from "./helper";
import jwtDecode from 'jwt-decode';
// import { Asset } from "xero-node/dist/gen/model/assets/asset";
// import { AssetStatus, AssetStatusQueryParam } from "xero-node/dist/gen/model/assets/models";
// import { Project, ProjectCreateOrUpdate, ProjectPatch, ProjectStatus, TimeEntry, TimeEntryCreateOrUpdate } from 'xero-node/dist/gen/model/projects/models';
// import { Employee as AUPayrollEmployee, HomeAddress, State, EmployeeStatus, EarningsType, EarningsLine } from 'xero-node/dist/gen/model/payroll-au/models';
// import { FeedConnections, FeedConnection, CountryCode, Statements, Statement, CreditDebitIndicator, CurrencyCode as BankfeedsCurrencyCode } from 'xero-node/dist/gen/model/bankfeeds/models';
// import { Employee as UKPayrollEmployee, Employment } from 'xero-node/dist/gen/model/payroll-uk/models';
// import { Employment as NZPayrollEmployment, EmployeeLeaveSetup as NZEmployeeLeaveSetup, Employee as NZEmployee } from 'xero-node/dist/gen/model/payroll-nz/models';
// import { ObjectGroup } from "xero-node/dist/gen/model/files/models";

const session = require("express-session");
var FileStore = require('session-file-store')(session);
const path = require("path");
// const mime = require("mime-types");

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const redirectUrl = process.env.REDIRECT_URI;
const scopes = [
  "offline_access",
  "openid",
  "profile",
  "email",
  // "accounting.transactions",
  "accounting.transactions.read",
  "accounting.reports.read",
  // "accounting.journals.read",
  // "accounting.settings",
  // "accounting.settings.read",
  // "accounting.contacts",
  "accounting.contacts.read",
  // "accounting.attachments",
  // "accounting.attachments.read",
  // "files",
  // "files.read",
  // "assets",
  // "assets.read",
  // "projects",
  // "projects.read",
  // "payroll.employees",
  "payroll.employees.read",
  // "payroll.payruns",
  // "payroll.payslip",
  // "payroll.payslip.read",
  // "payroll.timesheets",
  // "payroll.setting"
].join(' ');


let tenantCache = {}
loadTenantCached();

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

  
  sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  };

  verifyWebhookEventSignature(req: Request) {
    let computedSignature = crypto.createHmac('sha256', process.env.WEBHOOK_KEY).update(req.body.toString()).digest('base64');
    let xeroSignature = req.headers['x-xero-signature'];

    if (xeroSignature === computedSignature) {
      console.log('Signature passed! This is from Xero!');
      return true;
    } else {
      // If this happens someone who is not Xero is sending you a webhook
      console.log('Signature failed. Webhook might not be from Xero or you have misconfigured something...');
      console.log(`Got {${computedSignature}} when we were expecting {${xeroSignature}}`);
      return false;
    }
  };

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
        const authData = this.authenticationData(req, res)

        res.render("home", {
          consentUrl: await xero.buildConsentUrl(),
          authenticated: authData
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

        console.log('xero.config.state: ', xero.config.state)

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
        

        res.render("callback", {
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
    });

    router.post("/change_organisation", async (req: Request, res: Response) => {
      try {
        const activeOrgId = req.body.active_org_id
        const picked = xero.tenants.filter((tenant) => tenant.tenantId == activeOrgId)[0]
        req.session.activeTenant = picked
        // const authData = this.authenticationData(req, res)

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

        const authData = this.authenticationData(req, res)

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
        if(!tenantCacheExists(tenantId, 'averageSalary')) {
          const invoiceTables = await loadAverageSalary(tenantId);
          updateTenantCache(tenantId, 'averageSalary', invoiceTables);
          saveTenantCache();
        }

        const {employeesCount, averageSalary} = getTenantCache(tenantId, 'averageSalary');

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

        if(!tenantCacheExists(tenantId, 'invoiceTables')) {
          const invoiceTables = await loadInvoiceTables(tenantId);
          updateTenantCache(tenantId, 'invoiceTables', invoiceTables);
          saveTenantCache();
        }

        const {customerTable, supplierTable} = getTenantCache(tenantId, 'invoiceTables');

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

// Move to own file?
function calculateAnnualSalary(employee: any):number {
  let salary = 0;
  const earningLines = employee.payTemplate.earningsLines || [];
  salary = earningLines.reduce((sum, line) => calculateAnnualEarnings(line), 0);
  return salary;
}

function calculateAnnualEarnings(earningsLine: any): number {
  let amount = 0;
  switch(earningsLine.calculationType) {
    case "ENTEREARNINGSRATE": amount = (earningsLine.ratePerUnit || 0) * (earningsLine.normalNumberOfUnits || 0); break;
    case "ANNUALSALARY": amount = (earningsLine.annualSalary || 0); break;
    default:break;
  }
  return amount;
}




function getTenantCache(tenantId, type) {
  return (tenantCache[tenantId] || {})[type] || {};
}
function loadTenantCached() {
  try {
    const cache = JSON.parse(fs.readFileSync('./cache.json',
    {encoding:'utf8', flag:'r'}));
    tenantCache = cache;
  } catch(e) {

  } finally {
    return tenantCache;
  }
}

function updateTenantCache(tenantId, type, data) {
  tenantCache[tenantId] = tenantCache[tenantId] || {};
  tenantCache[tenantId][type] = data;
}

function tenantCacheExists(tenantId, type) {
  return tenantCache[tenantId] && tenantCache[tenantId][type] !== undefined;
}

function saveTenantCache() {
  try {
    fs.writeFileSync('./cache.json', JSON.stringify(tenantCache), {encoding:'utf8'});
  } catch(e) {

  } finally {

  }
  
}

async function loadInvoiceTables(tenantId) {
  const getContactsResponse = await xero.accountingApi.getContacts(tenantId);
        
  const getInvoicesResponse = await xero.accountingApi.getInvoices(tenantId);
  const now = new Date();
  let oneYearAgo = new Date( now.getFullYear() - 1, now.getMonth(), now.getDate());

  const invoices = getInvoicesResponse.body.invoices.filter(invoice => new Date(invoice.date).getTime() >= oneYearAgo.getTime() )

  const customers = getContactsResponse.body.contacts.filter(contact => contact.isCustomer === true)

  const suppliers = getContactsResponse.body.contacts.filter(contact => contact.isSupplier === true)

  const accountsRec = invoices.filter(invoice => invoice.type === Invoice.TypeEnum.ACCREC);
  const accountsPay = invoices.filter(invoice => invoice.type === Invoice.TypeEnum.ACCPAY);

  const grouper = ({items, getKey, getValue, accumulator, startValue}) => items.reduce((table, item) => {
    const key = getKey(item);
    table[key] = table[key] || startValue;
    table[key] = accumulator(table[key], getValue(item));
    return table;
  }, {});

  const accrecSumByCustomer = grouper({
    items: accountsRec,
    getKey: invoice => invoice.contact.contactID,
    getValue: invoice => invoice.total,
    accumulator: (a, b) => a + b,
    startValue: 0
  });

  const accPaySumBySupplier = grouper({
    items: accountsPay,
    getKey: invoice => invoice.contact.contactID,
    getValue: invoice => invoice.total,
    accumulator: (a, b) => a + b,
    startValue: 0
  });

  const customerTable = customers.map(customer => ({ name: customer.name, total: accrecSumByCustomer[customer.contactID] || 0 }));
  const supplierTable = suppliers.map(supplier => ({ name: supplier.name, total: accPaySumBySupplier[supplier.contactID] || 0 }));
  return {customerTable, supplierTable};
}

async function loadAverageSalary(tenantId) {
  const getEmployeesResponse = await xero.payrollAUApi.getEmployees(tenantId);
  const employeesCount:number = getEmployeesResponse.body.employees.length
  const employeeIDs:string[] = getEmployeesResponse.body.employees.map(employee => employee.employeeID)
  const employees = [];
  
  // Limit rate to xero for employee requests
  for(let i = 0; i < employeeIDs.length; i++) {
    const employeeID = employeeIDs[i];
    const employeeResponse = await xero.payrollAUApi.getEmployee(tenantId, employeeID);
    const employee = employeeResponse.body.employees[0];
    employees.push(employee);
  }

  const totalSalary = employees.map(calculateAnnualSalary).reduce((sum, salery) => sum + salery, 0);
  const averageSalary = totalSalary / employeesCount;

  return { averageSalary, employeesCount };
}
export default new App().app;

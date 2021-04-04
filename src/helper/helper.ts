
import {
    Invoice,
    XeroClient,
  } from "xero-node";

export default class Helper {

    xero: XeroClient;

    constructor(xero: XeroClient) {
        this.xero = xero;
    }
    public async loadInvoiceTables(tenantId):Promise<InvoiceTables> {
        const getContactsResponse = await this.xero.accountingApi.getContacts(tenantId);
              
        const getInvoicesResponse = await this.xero.accountingApi.getInvoices(tenantId);
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

      async loadAverageSalary(tenantId):Promise<AverageSalaries> {
        const getEmployeesResponse = await this.xero.payrollAUApi.getEmployees(tenantId);
        const employeesCount:number = getEmployeesResponse.body.employees.length
        const employeeIDs:string[] = getEmployeesResponse.body.employees.map(employee => employee.employeeID)
        const employees = [];
        
        // Limit rate to xero for employee requests
        for(let i = 0; i < employeeIDs.length; i++) {
          const employeeID = employeeIDs[i];
          const employeeResponse = await this.xero.payrollAUApi.getEmployee(tenantId, employeeID);
          const employee = employeeResponse.body.employees[0];
          employees.push(employee);
        }
      
        const totalSalary = employees.map(Helper.calculateAnnualSalary).reduce((sum, salery) => sum + salery, 0);
        const averageSalary = totalSalary / employeesCount;
      
        return { averageSalary, employeesCount };
      }

      private static calculateAnnualSalary(employee: any):number {
        let salary = 0;
        const earningLines = employee.payTemplate.earningsLines || [];
        salary = earningLines.reduce((sum, line) => Helper.calculateAnnualEarnings(line), 0);
        return salary;
      }
      
      private static  calculateAnnualEarnings(earningsLine: any): number {
        let amount = 0;
        switch(earningsLine.calculationType) {
          case "ENTEREARNINGSRATE": amount = (earningsLine.ratePerUnit || 0) * (earningsLine.normalNumberOfUnits || 0); break;
          case "ANNUALSALARY": amount = (earningsLine.annualSalary || 0); break;
          default:break;
        }
        return amount;
      }
}

export type InvoiceTotal = {
    name:string, total:number
}

export type InvoiceTables = {
    customerTable: InvoiceTotal[], 
    supplierTable: InvoiceTotal[]
}

export type AverageSalaries = {
    averageSalary: number,
    employeesCount: number
} 
-- Төлбөрийн аргууд: «Бэлэн» төрөл. CASH мөр дансны дугааргүй (accountNumber NULL).
ALTER TYPE "PaymentAccountType" ADD VALUE IF NOT EXISTS 'CASH' BEFORE 'BANK_ACCOUNT';

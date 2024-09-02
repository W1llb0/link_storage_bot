/*
  Warnings:

  - Added the required column `userId` to the `link` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "link" ADD COLUMN     "userId" INTEGER NOT NULL;

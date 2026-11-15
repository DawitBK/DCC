import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  CreateBrandRequest,
  CreateCompanyRequest,
  UpdateBrandRequest,
  UpdateCompanyRequest,
} from '@dcc/contracts';
import type { Access } from '../../platform/authz/authz';
import { RequirePermission } from '../../platform/authz/decorators';
import { CurrentAccess, ZodValidationPipe } from '../../platform/http/http-support';
import { CompaniesService } from './companies.service';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermission('company.read')
  list(@CurrentAccess() access: Access) {
    return this.companies.list(access);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('company.manage')
  create(
    @CurrentAccess() access: Access,
    @Body(new ZodValidationPipe(CreateCompanyRequest)) body: CreateCompanyRequest,
  ) {
    return this.companies.create(access, body);
  }

  @Patch(':companyId')
  @RequirePermission('company.manage')
  update(
    @CurrentAccess() access: Access,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body(new ZodValidationPipe(UpdateCompanyRequest)) body: UpdateCompanyRequest,
  ) {
    return this.companies.update(access, companyId, body);
  }

  @Patch(':companyId/brands/:brandId')
  @RequirePermission('brand.manage')
  updateBrand(
    @CurrentAccess() access: Access,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('brandId', ParseUUIDPipe) brandId: string,
    @Body(new ZodValidationPipe(UpdateBrandRequest)) body: UpdateBrandRequest,
  ) {
    return this.companies.updateBrand(access, companyId, brandId, body);
  }

  @Get(':companyId/brands')
  @RequirePermission('brand.read')
  listBrands(
    @CurrentAccess() access: Access,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    return this.companies.listBrands(access, companyId);
  }

  @Post(':companyId/brands')
  @HttpCode(201)
  @RequirePermission('brand.manage')
  createBrand(
    @CurrentAccess() access: Access,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body(new ZodValidationPipe(CreateBrandRequest)) body: CreateBrandRequest,
  ) {
    return this.companies.createBrand(access, companyId, body);
  }
}

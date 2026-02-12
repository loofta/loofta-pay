import { Controller, Get, Post, Put, Body, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards';
import { FreelancerProfilesService } from './freelancer-profiles.service';
import {
  CreateFreelancerProfileDto,
  UpdateFreelancerProfileDto,
  FreelancerProfileResponse,
} from './dto';

@ApiTags('freelancer-profile')
@Controller('freelancer-profile')
@UseGuards(AuthGuard)
@ApiSecurity('privy-auth')
export class FreelancerProfilesController {
  constructor(private readonly service: FreelancerProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user freelancer profile' })
  @ApiResponse({ status: 200 })
  async get(@Headers('x-privy-user-id') userId: string): Promise<FreelancerProfileResponse | null> {
    return this.service.getByUserId(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create freelancer profile (invoicing, TVA, KYC optional)' })
  @ApiResponse({ status: 201 })
  create(
    @Body() dto: CreateFreelancerProfileDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<FreelancerProfileResponse> {
    return this.service.getOrCreate(userId, dto);
  }

  @Put()
  @ApiOperation({ summary: 'Update freelancer profile' })
  @ApiResponse({ status: 200 })
  update(
    @Body() dto: UpdateFreelancerProfileDto,
    @Headers('x-privy-user-id') userId: string,
  ): Promise<FreelancerProfileResponse> {
    return this.service.update(userId, dto);
  }
}

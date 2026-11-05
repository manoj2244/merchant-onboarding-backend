import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsISO4217CurrencyCode,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { BusinessType } from '../application.enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateApplicationDto {
  @ApiProperty({ example: 'Example Coffee Roasters' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  businessName: string;

  @ApiProperty({ example: 'Example Coffee Roasters Pvt. Ltd.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalBusinessName: string;

  @ApiProperty({ enum: BusinessType })
  @IsEnum(BusinessType)
  businessType: BusinessType;

  @ApiPropertyOptional({ example: 'https://coffee.example.com' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(255)
  website?: string;

  @ApiProperty({ example: 'Jane Example' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  ownerFullName: string;

  @ApiProperty({ example: 'owner@example.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  ownerEmail: string;

  @ApiProperty({ example: '+15550100000', description: 'E.164 format' })
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'ownerPhone must be in E.164 format, e.g. +15550100000' })
  ownerPhone: string;

  @ApiProperty({ example: 'TEST-000-1234', description: 'Owner/business tax identifier (sensitive)' })
  @Matches(/^[A-Za-z0-9-]{4,64}$/, { message: 'ownerTaxId must be 4-64 letters, digits or dashes' })
  ownerTaxId: string;

  @ApiProperty({ example: 50000, description: 'Expected monthly card volume' })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(999_999_999_999.99)
  requestedMonthlyVolume: number;

  @ApiProperty({ example: 25.5 })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  @Max(9_999_999_999.99)
  averageTicketSize: number;

  @ApiProperty({ example: '5814', description: 'ISO 18245 merchant category code' })
  @Matches(/^\d{4}$/, { message: 'mcc must be a 4-digit merchant category code' })
  mcc: string;

  @ApiProperty({ example: 'USD' })
  @IsISO4217CurrencyCode()
  currency: string;
}

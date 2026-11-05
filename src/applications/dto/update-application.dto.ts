import { PartialType } from '@nestjs/swagger';
import { CreateApplicationDto } from './create-application.dto';

/**
 * Any subset of the business fields. Status, ownership and assignment are never client-writable.
 * skipNullProperties: false → a field that is present is always validated, so `null` for a
 * required column is a 400 (not a NOT NULL violation / 500). `website` stays nullable via its
 * own @IsOptional, so it can still be cleared.
 */
export class UpdateApplicationDto extends PartialType(CreateApplicationDto, { skipNullProperties: false }) {}

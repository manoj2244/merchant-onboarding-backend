import { PartialType } from '@nestjs/swagger';
import { CreateApplicationDto } from './create-application.dto';

/** Any subset of the business fields. Status, ownership and assignment are never client-writable. */
export class UpdateApplicationDto extends PartialType(CreateApplicationDto) {}

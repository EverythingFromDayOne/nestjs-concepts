import { applyDecorators } from '@nestjs/common';
import { Roles } from './roles.decorator';

export const AdminOnly = () => applyDecorators(Roles(['admin']));

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Author } from '../../domain';

/**
 * Wire shape of an {@link Author}. A near-copy of the domain type today, but kept
 * separate on purpose: the domain model is internal and free to change, while
 * this is the published API contract. The `fromDomain` mapper is the one place
 * that translates between them.
 */
export class AuthorResponseDto {
  @ApiProperty({ description: 'Platform-scoped author id.' })
  id!: string;

  @ApiProperty({ description: 'Author display name.' })
  displayName!: string;

  @ApiPropertyOptional({
    description: 'Author avatar URL, if the platform gives one.',
  })
  avatarUrl?: string;

  static fromDomain(author: Author): AuthorResponseDto {
    const dto = new AuthorResponseDto();
    dto.id = author.id;
    dto.displayName = author.displayName;
    dto.avatarUrl = author.avatarUrl;
    return dto;
  }
}

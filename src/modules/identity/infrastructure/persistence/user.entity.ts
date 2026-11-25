import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'identity_users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 254, unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'text', select: false })
  passwordHash!: string;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'platform_founder', type: 'boolean', default: false })
  platformFounder!: boolean;

  @Column({
    name: 'session_version',
    type: 'bigint',
    default: 0,
    select: false,
  })
  sessionVersion!: string;
}

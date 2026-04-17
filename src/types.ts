export interface Product {
  id: number;
  nome: string;
  preco: number;
  img: string;
}

export interface CartItem extends Product {
  cartId: string;
}

export interface PixData {
  qr_code: string;
  qr_code_base64: string;
}

export interface CheckoutForm {
  nome: string;
  email: string;
  cpf: string;
  telefone: string;
  cep: string;
  endereco: string;
  numero: string;
  cidade: string;
  estado: string;
}

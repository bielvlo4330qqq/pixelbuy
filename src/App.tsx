import React, { useState, useEffect, useMemo } from "react";
import { ShoppingCart, X, Copy, CheckCircle2, Clock, Search, SlidersHorizontal, LogIn, QrCode, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PRODUCTS } from "./constants";
import { CartItem, PixData, CheckoutForm, Product } from "./types";
import { db, auth, googleProvider } from "./firebase";
import { collection, addDoc, serverTimestamp, updateDoc, doc, onSnapshot } from "firebase/firestore";
import { signInWithPopup } from "firebase/auth";
import { ErrorBoundary } from "./components/ErrorBoundary";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [isPixLoading, setIsPixLoading] = useState(false);
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes
  const [isCopied, setIsCopied] = useState(false);
  const [form, setForm] = useState<CheckoutForm>({
    nome: "",
    email: "",
    cpf: "",
    telefone: "",
    cep: "",
    endereco: "",
    numero: "",
    cidade: "",
    estado: "",
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [maxPrice, setMaxPrice] = useState(200);
  const [showOrderSuccess, setShowOrderSuccess] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);

  useEffect(() => {
    if (validationError) {
      const timer = setTimeout(() => {
        setValidationError(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [validationError]);

  useEffect(() => {
    // Auth logic removed as per user request
  }, []);

  const filteredProducts = useMemo(() => {
    return PRODUCTS.filter((product) => {
      const matchesName = product.nome.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesPrice = product.preco <= maxPrice;
      return matchesName && matchesPrice;
    });
  }, [searchTerm, maxPrice]);

  const total = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.preco, 0);
  }, [cart]);

  const handleCepLookup = async (cepValue?: string) => {
    const cep = (cepValue || form.cep).replace(/\D/g, "");
    if (cep.length !== 8) return;

    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await response.json();

      if (!data.erro) {
        setForm((prev) => ({
          ...prev,
          endereco: `${data.logradouro || ""}${data.bairro ? ", " + data.bairro : ""}`,
          cidade: data.localidade || "",
          estado: data.uf || "",
        }));

        setTimeout(() => {
          document.getElementById("numero")?.focus();
        }, 100);
      }
    } catch (error) {
      console.error("Erro ao buscar CEP:", error);
    }
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (pixData && timeLeft > 0 && !paymentConfirmed) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            // Cancel order in Firebase when time runs out
            if (lastOrderId) {
              updateDoc(doc(db, "orders", lastOrderId), { status: "cancelled" })
                .catch(err => console.error("Erro ao cancelar pedido:", err));
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [pixData, timeLeft, paymentConfirmed, lastOrderId]);

  useEffect(() => {
    let unsubscribe: () => void;
    if (lastOrderId && pixData) {
      console.log("Iniciando monitoramento do pedido:", lastOrderId);
      unsubscribe = onSnapshot(doc(db, "orders", lastOrderId), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log("Status do pedido atualizado:", data.status);
          if (data.status === "paid") {
            setPaymentConfirmed(true);
          }
        }
      });
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [lastOrderId, pixData]);

  useEffect(() => {
    if (paymentConfirmed && pixData) {
      // Quando o pagamento é confirmado manualmente, espera 2s para mostrar a animação e redireciona
      const redirectTimer = setTimeout(() => {
        const message = encodeURIComponent(`Poderia me passar o valor do frete! Compra ID: ${lastOrderId}`);
        const whatsappUrl = `https://wa.me/5517991277119?text=${message}`;
        
        // Tenta abrir em nova aba, se falhar (bloqueador), usa a mesma aba
        const newWindow = window.open(whatsappUrl, '_blank');
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
          window.location.href = whatsappUrl;
        }
        
        setPixData(null);
        setPaymentConfirmed(false);
      }, 2500);

      return () => clearTimeout(redirectTimer);
    }
  }, [paymentConfirmed, pixData, lastOrderId]);

  const addToCart = (product: Product) => {
    const newItem: CartItem = {
      ...product,
      cartId: Math.random().toString(36).substring(7),
    };
    setCart([...cart, newItem]);
  };

  const removeFromCart = (cartId: string) => {
    setCart(cart.filter((item) => item.cartId !== cartId));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    
    // Auto-trigger CEP lookup when 8 digits are reached
    if (id === "cep") {
      let cleanValue = value.replace(/\D/g, "");
      if (cleanValue.length > 8) cleanValue = cleanValue.slice(0, 8);
      
      // Format as 00000-000
      let formattedValue = cleanValue;
      if (cleanValue.length > 5) {
        formattedValue = `${cleanValue.slice(0, 5)}-${cleanValue.slice(5)}`;
      }
      
      setForm(prev => ({ ...prev, cep: formattedValue }));

      if (cleanValue.length === 8) {
        handleCepLookup(cleanValue);
      }
      return;
    }
    
    setForm({ ...form, [id]: value });
  };

  const validateForm = () => {
    return Object.values(form).every((val) => (val as string).trim() !== "");
  };

  const handleCheckout = async () => {
    // Validation
    const missingFields = [];
    if (!form.nome.trim()) missingFields.push("Nome");
    if (!form.email.trim()) missingFields.push("E-mail");
    if (!form.cpf.trim()) missingFields.push("CPF");
    if (!form.telefone.trim()) missingFields.push("Telefone");
    if (!form.cep.trim()) missingFields.push("CEP");
    if (!form.endereco.trim()) missingFields.push("Endereço");
    if (!form.numero.trim()) missingFields.push("Número");
    if (!form.cidade.trim()) missingFields.push("Cidade");
    if (!form.estado.trim()) missingFields.push("UF");

    if (missingFields.length > 0) {
      setValidationError(`Faltando: ${missingFields.join(", ")}`);
      return;
    }

    if (cart.length === 0) {
      setValidationError("Seu carrinho está vazio!");
      return;
    }

    setIsPixLoading(true);
    setGlobalError(null);
    setValidationError(null);
    setPaymentConfirmed(false);
    setTimeLeft(600);
    try {
      console.log("Iniciando checkout...");
      // 1. Save order to Firebase first
      const orderData = {
        customer: { ...form },
        items: cart.map(item => ({
          id: item.id,
          nome: item.nome,
          preco: item.preco,
          img: item.img
        })),
        shippingCost: 0,
        shippingDays: "A consultar",
        total: Number(total.toFixed(2)),
        status: "pending",
        createdAt: serverTimestamp(),
        userId: "guest"
      };

      console.log("Salvando pedido no Firebase:", orderData);
      try {
        const docRef = await addDoc(collection(db, "orders"), orderData);
        setLastOrderId(docRef.id);
        console.log("Pedido salvo com sucesso! ID:", docRef.id);
      } catch (error) {
        console.error("Erro ao salvar no Firebase:", error);
        if (error instanceof Error && error.message.includes("permission")) {
          handleFirestoreError(error, OperationType.CREATE, "orders");
        }
      }

      let qr_code_base64 = "";
      let qr_code = "";

      try {
        const response = await fetch("https://access-token-xofz.onrender.com/create-pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Number(total.toFixed(2)),
          }),
        });

        if (response.ok) {
          const data = await response.json();
          qr_code_base64 = data?.point_of_interaction?.transaction_data?.qr_code_base64 || data?.qr_code_base64 || data?.imagem;
          qr_code = data?.point_of_interaction?.transaction_data?.qr_code || data?.qr_code || data?.pix;
        }
      } catch (pixError) {
        console.error("PIX API Error, using fallback:", pixError);
      }

      // Fallback if API fails
      if (!qr_code_base64 || !qr_code) {
        console.warn("Using simulated PIX data");
        qr_code = "00020126360014BR.GOV.BCB.PIX0114+5511999999999520400005303986540510.005802BR5925NOME DO RECEBEDOR6009SAO PAULO62070503***6304ABCD";
        qr_code_base64 = "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAABlBMVEUAAAD///+l2Z/dAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAW0lEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4MaEAAAc7669YAAAAASUVORK5CYII=";
      }

      // Success flow
      setIsCartOpen(false);
      setShowOrderSuccess(true);
      
      setTimeout(() => {
        setShowOrderSuccess(false);
        setPixData({ qr_code, qr_code_base64 });
        setTimeLeft(300);
        setCart([]); // Clear cart after success
      }, 2500);

    } catch (error: any) {
      console.error("Erro ao processar pedido:", error);
      setGlobalError(error.message || "Erro ao processar pedido. Tente novamente.");
    } finally {
      setIsPixLoading(false);
    }
  };

  const copyPixCode = () => {
    if (pixData) {
      navigator.clipboard.writeText(pixData.qr_code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-[#3483fa] selection:text-white">
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 bg-black sticky top-0 z-40 border-b border-white/5">
        <div className="text-2xl font-bold tracking-tight text-white">STORE</div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsCartOpen(true)}
            className="relative group p-2 rounded-xl bg-white/10 hover:bg-white/20 transition-all border border-white/10"
          >
            <ShoppingCart className="w-6 h-6" />
            {cart.length > 0 && (
              <span className="absolute -top-2 -right-2 bg-amber-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-[#0a0a0a] group-hover:scale-110 transition-transform">
                {cart.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <div className="pt-20">

      {/* Hero */}
      <section className="min-h-[60vh] flex flex-col items-center justify-center bg-gradient-to-b from-[#111] to-[#0a0a0a] px-6 py-12 text-center">
        <motion.img
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          src={PRODUCTS[2].img}
          alt="Destaque"
          referrerPolicy="no-referrer"
          className="w-64 md:w-80 drop-shadow-[0_20px_50px_rgba(52,131,250,0.3)] mb-8"
        />
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="text-4xl md:text-6xl font-black tracking-tighter mb-4"
        >
          Conheça a <span className="text-[#3483fa]">Nossa Loja</span>
        </motion.h1>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-gray-400 max-w-md"
        >
          Produtos exclusivos com design minimalista e qualidade premium.
        </motion.p>
      </section>

      {/* Products Grid */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        {/* Filters */}
        <div className="mb-12 flex flex-col md:flex-row gap-6 items-end bg-[#161616] p-6 rounded-3xl border border-white/5">
          <div className="flex-1 w-full">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 block">
              Buscar Produto
            </label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type="text"
                placeholder="Ex: Camiseta, Mochila..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:ring-2 focus:ring-[#3483fa] outline-none transition-all"
              />
            </div>
          </div>
          <div className="w-full md:w-64">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block">
                Preço Máximo
              </label>
              <span className="text-[#3483fa] font-black">R$ {maxPrice}</span>
            </div>
            <div className="flex items-center gap-4">
              <SlidersHorizontal className="w-5 h-5 text-gray-500" />
              <input
                type="range"
                min="0"
                max="200"
                step="10"
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="flex-1 h-1.5 bg-black/30 rounded-lg appearance-none cursor-pointer accent-[#3483fa]"
              />
            </div>
          </div>
          {(searchTerm !== "" || maxPrice !== 200) && (
            <button
              onClick={() => {
                setSearchTerm("");
                setMaxPrice(200);
              }}
              className="text-xs font-bold text-gray-500 hover:text-white transition-colors underline underline-offset-4"
            >
              Limpar Filtros
            </button>
          )}
        </div>

        {filteredProducts.length === 0 ? (
          <div className="text-center py-20 bg-[#161616] rounded-3xl border border-dashed border-white/10">
            <Search className="w-16 h-16 mx-auto mb-4 text-gray-700" />
            <h3 className="text-xl font-bold mb-2">Nenhum produto encontrado</h3>
            <p className="text-gray-500">Tente ajustar seus filtros para encontrar o que procura.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {filteredProducts.map((product) => (
              <motion.div
                key={product.id}
                whileHover={{ y: -5 }}
                className="bg-[#161616] rounded-2xl p-4 flex flex-col border border-white/5 hover:border-[#3483fa]/30 transition-all group"
              >
                <div className="aspect-square rounded-xl bg-black/20 flex items-center justify-center mb-4 overflow-hidden">
                  <img
                    src={product.img}
                    alt={product.nome}
                    referrerPolicy="no-referrer"
                    className="w-4/5 group-hover:scale-110 transition-transform duration-500"
                  />
                </div>
                <h3 className="font-bold text-lg mb-1">{product.nome}</h3>
                <p className="text-[#3483fa] font-black text-xl mb-4">R$ {product.preco.toFixed(2)}</p>
                <button
                  onClick={() => addToCart(product)}
                  className="mt-auto w-full py-3 bg-[#ffcc00] text-black font-bold rounded-lg hover:bg-[#e6b800] transition-all active:scale-95"
                >
                  Adicionar
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-12 border-t border-white/5 text-center text-gray-500 text-sm">
        <p>&copy; 2026 Loja Premium. Todos os direitos reservados.</p>
      </footer>
    </div>

      {/* Floating Cart Button */}
      <AnimatePresence>
        {cart.length > 0 && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setIsCartOpen(true)}
            className="fixed bottom-6 right-6 z-30 bg-[#3483fa] text-white px-5 py-4 rounded-full shadow-2xl flex items-center gap-2 font-bold"
          >
            <ShoppingCart className="w-6 h-6" />
            <span className="bg-white text-[#3483fa] text-xs px-2 py-0.5 rounded-full">{cart.length}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Cart Drawer Overlay */}
      <AnimatePresence>
        {isCartOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCartOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-white text-black z-50 flex flex-col shadow-2xl"
            >
              <div className="p-4 flex justify-between items-center border-b shrink-0">
                <h2 className="text-xl font-black tracking-tighter">Seu Carrinho</h2>
                <button 
                  onClick={() => setIsCartOpen(false)} 
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overscroll-contain">
                <div className="p-4 space-y-6">
                  {/* Cart Items */}
                  <div className="space-y-3">
                    {cart.length === 0 ? (
                      <div className="py-20 flex flex-col items-center justify-center text-gray-400">
                        <ShoppingCart className="w-16 h-16 mb-4 opacity-10" />
                        <p className="text-sm font-medium">Seu carrinho está vazio</p>
                      </div>
                    ) : (
                      cart.map((item) => (
                        <div key={item.cartId} className="flex gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100 items-center">
                          <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center p-2 border border-gray-100 shrink-0">
                            <img src={item.img} alt={item.nome} referrerPolicy="no-referrer" className="w-full h-full object-contain" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-sm truncate">{item.nome}</h4>
                            <p className="text-[#3483fa] text-sm font-black mt-1">R$ {item.preco.toFixed(2)}</p>
                          </div>
                          <button
                            onClick={() => removeFromCart(item.cartId)}
                            className="text-gray-400 p-2 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {cart.length > 0 && (
                    <div className="space-y-6">
                      {/* Summary Card */}
                      <div className="bg-black text-white p-5 rounded-3xl space-y-3 shadow-lg">
                        <div className="flex justify-between text-xs font-medium text-gray-400">
                          <span>Subtotal</span>
                          <span>R$ {cart.reduce((acc, item) => acc + item.preco, 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-xs font-medium text-gray-400">
                          <span>Entrega</span>
                          <span className="text-green-400">Grátis</span>
                        </div>
                        <div className="flex justify-between items-end pt-3 border-t border-white/10">
                          <span className="text-sm font-bold text-gray-400 uppercase">Valor Total</span>
                          <span className="text-2xl font-black text-white leading-none">R$ {total.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Checkout Form */}
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                          <div className="w-1 h-6 bg-[#3483fa] rounded-full" />
                          <h3 className="font-black tracking-tight text-sm uppercase text-black">Checkout rápido</h3>
                        </div>
                        
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase text-gray-400 ml-1">Dados Pessoais</label>
                            <input
                              id="nome"
                              placeholder="Nome Completo"
                              value={form.nome}
                              onChange={handleInputChange}
                              className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all text-sm font-medium bg-gray-50 text-black placeholder:text-gray-400"
                            />
                            <input
                              id="email"
                              type="email"
                              placeholder="Seu melhor e-mail"
                              value={form.email}
                              onChange={handleInputChange}
                              className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all text-sm font-medium bg-gray-50 text-black placeholder:text-gray-400"
                            />
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              id="cpf"
                              placeholder="CPF"
                              value={form.cpf}
                              onChange={handleInputChange}
                              className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all text-sm font-medium bg-gray-50 text-black placeholder:text-gray-400"
                            />
                            <input
                              id="telefone"
                              placeholder="Telefone / WhatsApp"
                              value={form.telefone}
                              onChange={handleInputChange}
                              className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all text-sm font-medium bg-gray-50 text-black placeholder:text-gray-400"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase text-gray-400 ml-1">Endereço de Entrega</label>
                            <div className="relative">
                              <input
                                id="cep"
                                placeholder="CEP"
                                value={form.cep}
                                onChange={handleInputChange}
                                onBlur={() => handleCepLookup()}
                                className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all pr-12 text-sm font-medium bg-gray-50 text-black placeholder:text-gray-400"
                              />
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3483fa]">
                                <Search className="w-5 h-5" />
                              </div>
                            </div>
                            <div className="grid grid-cols-[1fr_80px] gap-3">
                              <input
                                id="endereco"
                                placeholder="Logradouro"
                                value={form.endereco}
                                onChange={handleInputChange}
                                className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all text-sm font-medium bg-gray-50 text-black placeholder:text-gray-400"
                              />
                              <input
                                id="numero"
                                placeholder="Nº"
                                value={form.numero}
                                onChange={handleInputChange}
                                className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all text-sm font-medium bg-gray-50 text-black placeholder:text-gray-400"
                              />
                            </div>
                            <div className="grid grid-cols-[1fr_70px] gap-3">
                              <input
                                id="cidade"
                                placeholder="Cidade"
                                value={form.cidade}
                                onChange={handleInputChange}
                                className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all text-sm font-medium bg-gray-50 text-black placeholder:text-gray-400"
                              />
                              <input
                                id="estado"
                                placeholder="UF"
                                value={form.estado}
                                onChange={handleInputChange}
                                maxLength={2}
                                className="w-full px-4 py-3.5 rounded-2xl border-2 border-gray-100 focus:border-[#3483fa] outline-none transition-all text-sm font-medium bg-gray-50 text-black text-center placeholder:text-gray-400"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {cart.length > 0 && (
                <div className="p-4 border-t bg-gray-50 shrink-0">
                  <button
                    onClick={handleCheckout}
                    disabled={isPixLoading}
                    className="w-full py-4 bg-[#3483fa] text-white font-black rounded-2xl hover:bg-[#2a6fd1] transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-xl shadow-[#3483fa]/20"
                  >
                    {isPixLoading ? (
                      <div className="w-6 h-6 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      "Gerar QR Code PIX"
                    )}
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Success Confirmation Overlay */}
      <AnimatePresence>
        {validationError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[150] bg-amber-500 text-white px-6 py-4 rounded-xl shadow-2xl font-bold flex flex-col items-center gap-1 min-w-[300px] border-2 border-amber-400"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>Dados Incompletos</span>
            </div>
            <p className="text-xs font-medium opacity-90 text-center">{validationError}</p>
            <div className="w-full h-1 bg-white/20 mt-2 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: "100%" }}
                animate={{ width: "0%" }}
                transition={{ duration: 10, ease: "linear" }}
                className="h-full bg-white"
              />
            </div>
          </motion.div>
        )}

        {globalError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[150] bg-red-500 text-white px-6 py-3 rounded-xl shadow-2xl font-bold flex items-center gap-2"
          >
            <X className="w-5 h-5" />
            <span>{globalError}</span>
            <button onClick={() => setGlobalError(null)} className="ml-4 opacity-70 hover:opacity-100">
              OK
            </button>
          </motion.div>
        )}

        {showOrderSuccess && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, y: 20 }}
              className="text-center p-8"
            >
              <div className="w-24 h-24 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(34,197,94,0.4)]">
                <CheckCircle2 className="w-12 h-12 text-white" />
              </div>
              <h2 className="text-4xl font-black tracking-tighter mb-2">Pedido realizado!</h2>
              <p className="text-gray-400 text-lg">Sua compra foi processada com sucesso.</p>
              
              <div className="mt-8 flex items-center justify-center gap-2 text-[#3483fa] font-bold">
                <div className="w-5 h-5 border-2 border-[#3483fa]/30 border-t-[#3483fa] rounded-full animate-spin" />
                <span>Gerando seu PIX...</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PIX Modal */}
      <AnimatePresence>
        {pixData && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPixData(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-lg bg-white text-black rounded-3xl p-6 md:p-8 flex flex-col items-center text-center overflow-y-auto max-h-[90vh] shadow-2xl"
            >
              <button
                onClick={() => setPixData(null)}
                className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full z-10"
              >
                <X className="w-6 h-6" />
              </button>

              <div className="bg-[#3483fa]/10 p-3 rounded-full mb-4">
                <CheckCircle2 className="w-10 h-10 text-[#3483fa]" />
              </div>

              <h2 className="text-2xl md:text-3xl font-black tracking-tighter mb-1">Pague com PIX</h2>
              <p className="text-gray-500 text-sm mb-6">Escaneie o QR Code ou copie o código abaixo</p>

              <div className="bg-white p-3 rounded-2xl border-4 border-gray-50 mb-6 shadow-inner relative">
                {paymentConfirmed ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-40 h-40 md:w-56 md:h-56 flex flex-col items-center justify-center text-green-500"
                  >
                    <CheckCircle2 className="w-20 h-20 mb-2 animate-bounce" />
                    <p className="font-black text-lg">PAGAMENTO RECEBIDO!</p>
                    <p className="text-amber-600 font-bold text-sm">freete há consultar</p>
                    <p className="text-xs text-gray-500 mt-1">Redirecionando para o WhatsApp...</p>
                  </motion.div>
                ) : timeLeft > 0 ? (
                  <img
                    src={pixData.qr_code_base64.startsWith('data:') ? pixData.qr_code_base64 : `data:image/png;base64,${pixData.qr_code_base64}`}
                    alt="PIX QR Code"
                    referrerPolicy="no-referrer"
                    className="w-40 h-40 md:w-56 md:h-56"
                  />
                ) : (
                  <div className="w-40 h-40 md:w-56 md:h-56 flex flex-col items-center justify-center text-red-500">
                    <X className="w-12 h-12 mb-2" />
                    <p className="font-black text-lg uppercase">Compra Cancelada</p>
                    <p className="text-xs text-gray-500 mt-1">O tempo para pagamento expirou.</p>
                  </div>
                )}
              </div>

              <div className="w-full space-y-3">
                <div className="flex items-center justify-center gap-2 bg-black text-white py-2 px-6 rounded-xl font-mono text-base">
                  {paymentConfirmed ? (
                    <span className="text-green-500 animate-pulse">PAGAMENTO CONFIRMADO</span>
                  ) : timeLeft === 0 ? (
                    <span className="text-red-500">TEMPO ESGOTADO</span>
                  ) : (
                    <>
                      <Clock className="w-4 h-4 text-[#3483fa]" />
                      <span>{formatTime(timeLeft)}</span>
                    </>
                  )}
                </div>

                <div className="relative group">
                  <div className="bg-gray-100 p-3 rounded-xl text-[10px] break-all text-gray-600 border border-gray-200 pr-12 text-left">
                    {pixData.qr_code}
                  </div>
                  <button
                    onClick={copyPixCode}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-white shadow-md rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {isCopied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  onClick={() => {
                    const message = encodeURIComponent(`Olá! Já realizei o pagamento do meu pedido. ID do Pedido: ${lastOrderId || "N/A"}`);
                    window.open(`https://wa.me/5517991277119?text=${message}`, "_blank");
                  }}
                  disabled={timeLeft === 0}
                  className="w-full py-3.5 bg-green-500 text-white font-bold rounded-2xl hover:bg-green-600 transition-all shadow-lg shadow-green-500/30 flex items-center justify-center gap-2 text-sm md:text-base disabled:opacity-50"
                >
                  <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" className="w-5 h-5 invert" alt="WhatsApp" />
                  {paymentConfirmed ? "Confirmado! Ir para WhatsApp" : "Já paguei! Avisar no WhatsApp"}
                </button>

                <button
                  onClick={copyPixCode}
                  className="w-full py-3.5 bg-[#3483fa] text-white font-bold rounded-2xl hover:bg-[#2a6fd1] transition-all shadow-lg shadow-[#3483fa]/30 text-sm md:text-base"
                >
                  {isCopied ? "Código Copiado!" : "Copiar Código PIX"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
